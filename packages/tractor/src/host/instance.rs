//! PluginInstanceHandle — wraps a live wasmtime plugin instance.
//!
//! Supports two loader paths (ADR-061):
//!   - P2 Component: RefarmPluginHost WIT bindings + Store<TractorStore>
//!   - P1 Module: plain wasmtime::Instance + Store<P1Store>, WASI preview1 ABI

use anyhow::Result;
use wasmtime::Store;

use crate::host::plugin_host::{
    EpochGuard, HasEpochGuard, P1Store, RefarmPluginHost, TractorStore,
};
use crate::telemetry::TelemetryBus;

/// How many ticks the callback re-arms by when it decides to keep waiting. Small
/// so the next epoch checkpoint comes soon (re-check cancel/deadline promptly).
const EPOCH_REARM_TICKS: u64 = 1;

/// Create a store that is ALREADY armed against the epoch-interruption footgun.
///
/// epoch_interruption(true) makes a fresh store's default deadline 0, so ANY
/// guest code — including the component's own instantiate/start (heavy for a
/// jco/StarlingMonkey component) — traps with `wasm trap: interrupt` the instant
/// it runs unless the store carries an epoch_deadline_callback + a live deadline.
/// This factory creates the store AND arms it in one step, so an un-armed store
/// on an epoch-enabled engine is UNREPRESENTABLE: every production store goes
/// through here, and arming isn't a separate call anyone can forget. The callback
/// (epoch_decision) governs timeout/cancel thereafter, keyed off the store's own
/// EpochGuard via the HasEpochGuard accessor — so the same wiring serves both the
/// component (TractorStore) and P1 module (P1Store) stores.
///
/// The ONLY stores that must NOT go through this are on engines WITHOUT
/// epoch_interruption (the unit-test P1 fixture) or that deliberately test
/// unarmed behaviour (the epoch_semantics proofs).
pub(crate) fn new_armed_store<T: HasEpochGuard + 'static>(
    engine: &wasmtime::Engine,
    data: T,
) -> Store<T> {
    // The ONE blessed raw Store::new — everything after it is exactly the arming
    // that makes the store safe, so this is the site the clippy lint protects.
    #[allow(clippy::disallowed_methods)]
    let mut store = Store::new(engine, data);
    store.epoch_deadline_callback(|ctx| epoch_decision(ctx.data().epoch_guard()));
    store.set_epoch_deadline(1);
    store
}

/// The unified per-store epoch decision, run by every store's
/// epoch_deadline_callback when the shared epoch reaches its deadline. This is
/// the single mechanism covering BOTH timeout and cancel, and the escape from
/// the global-epoch footgun (proven in plugin_host_tests/epoch_semantics.rs):
/// - cancel flag set               -> Err(trap): force-interrupt now.
/// - wall-clock deadline elapsed   -> Err(trap): the on_event timeout.
/// - otherwise (woken early by a neighbour's crank, or no bounded call in
///   flight) -> Continue: re-arm and keep running. A neighbour never traps on
///   someone else's cancel because it judges by its OWN wall clock.
fn epoch_decision(guard: &EpochGuard) -> wasmtime::Result<wasmtime::UpdateDeadline> {
    use std::sync::atomic::Ordering;
    if guard.cancel.load(Ordering::SeqCst) {
        return Err(wasmtime::Trap::Interrupt.into());
    }
    let elapsed = guard
        .wall_deadline
        .lock()
        .expect("epoch wall_deadline poisoned")
        .map(|deadline| std::time::Instant::now() >= deadline)
        .unwrap_or(false);
    if elapsed {
        return Err(wasmtime::Trap::Interrupt.into());
    }
    Ok(wasmtime::UpdateDeadline::Continue(EPOCH_REARM_TICKS))
}

/// The runtime state of a loaded plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginState {
    Idle,
    Running,
    Hot,
    Throttled,
    Error,
}

// ── Internal discriminant ──────────────────────────────────────────────────────

enum PluginImpl {
    Component {
        plugin: RefarmPluginHost,
        store: Store<TractorStore>,
    },
    Module {
        instance: wasmtime::Instance,
        store: Store<P1Store>,
    },
}

// ── PluginInstanceHandle ───────────────────────────────────────────────────────

/// A handle to a live plugin instance.
///
/// Wraps either a P2 Component (WIT bindings) or a P1 Module (plain WASM).
/// The same public API is presented to callers regardless of the underlying variant.
pub struct PluginInstanceHandle {
    pub id: String,
    pub state: PluginState,
    /// Capabilities declared in the plugin's `capabilities.provides` manifest field.
    pub provides: Vec<String>,
    /// Runtime event names the plugin declared in `capabilities.subscribes` — what
    /// the neutral event router delivers to it. Defaults empty; set from the
    /// manifest via `with_subscribes` right after construction.
    pub subscribes: Vec<String>,
    /// Whether the plugin declared `capabilities.concurrentSafe` — i.e. its
    /// on_event is stateless and may be driven by a pool of N stores in parallel.
    /// Defaults false; set from the manifest via `with_concurrent_safe`.
    /// register_for_events reads it (with REFARM_PLUGIN_POOL) to choose between
    /// the single-store runner and the opt-in pooled runner.
    pub concurrent_safe: bool,
    /// APIs the plugin declared in `capabilities.requiresApi` (the SPI consumer
    /// side). Defaults empty; set via `with_requires_api`. register_for_events
    /// records it in the registry for the post-load advisory reconciliation.
    pub requires_api: Vec<String>,
    /// Per-verb usage prose from `capabilities.verbDocs` (promptSnippet Slice 2),
    /// keyed by `<key>:<verb>`. Defaults empty; set via `with_verb_docs`.
    /// register_for_events passes it to the registry so `list-tool-prompts` returns
    /// plugin-authored guidance instead of host boilerplate.
    pub verb_docs: std::collections::HashMap<String, String>,
    /// Verbs the plugin serves SYNCHRONOUSLY via `respond` (`capabilities.syncVerbs`,
    /// a subset of `provides`). Defaults empty (async-only); set via `with_sync_verbs`.
    /// The host consults `serves_sync` before a synchronous respond dispatch — ADR-084's
    /// negotiated flag enforced host-side.
    pub sync_verbs: Vec<String>,
    inner: PluginImpl,
    telemetry: TelemetryBus,
    /// Shared with the store's epoch_deadline_callback. Exposes the cancel flag
    /// (so a force-interrupt can flip it from another thread) and the in-flight
    /// wall-clock deadline (armed before on_event). Cloned from the store's
    /// EpochGuard at construction.
    epoch_guard: EpochGuard,
    /// Wall-clock budget (ms) for a single on_event call, stamped from the host
    /// config at load (env `REFARM_ON_EVENT_TIMEOUT_MS` is read ONCE at boot).
    /// Read on the per-event hot path instead of `std::env::var`. Defaults to the
    /// same 2s the env parser does, so test-constructed handles behave identically
    /// without setting process env.
    on_event_budget_ms: u64,
}

/// The default single-event wall-clock budget (ms), matching the
/// `REFARM_ON_EVENT_TIMEOUT_MS` env parser's fallback. Handles constructed
/// without an explicit budget (tests, non-boot paths) use this. `pub` so
/// integration tests and benches can pass an explicit, named default to
/// `PluginHost::new` instead of a bare literal.
///
/// 60s, NOT 2s: an `on_event` runs the plugin's whole reaction, and for the agent
/// that includes a SYNCHRONOUS LLM round-trip (via the model-bridge host call, which
/// the epoch cannot interrupt while it blocks). With a 2s budget the wall deadline
/// expired mid-LLM and the agent trapped on the FIRST wasm checkpoint after the call
/// returned — losing the model's response in post-processing and discarding the store.
/// The sidecar already waits ~45s for a response (`respond_watch` default), so a 2s
/// execution budget contradicted it. 60s covers a slow model turn; a deployment that
/// wants tighter (or looser) sets `REFARM_ON_EVENT_TIMEOUT_MS`. A per-plugin declared
/// budget in the manifest is the fuller fix (tracked) so a plugin states its own need.
pub const DEFAULT_ON_EVENT_BUDGET_MS: u64 = 60_000;

impl PluginInstanceHandle {
    pub(crate) fn new_component(
        id: String,
        plugin: RefarmPluginHost,
        store: Store<TractorStore>,
        telemetry: TelemetryBus,
        provides: Vec<String>,
    ) -> Self {
        // The epoch callback + baseline deadline were armed on this store at
        // creation (new_armed_store in load()), because the component's own
        // instantiate/start runs guest code that would otherwise trap on the
        // default-0 deadline. Here we only capture the guard handle.
        let epoch_guard = store.data().epoch_guard.clone();
        Self {
            id,
            state: PluginState::Idle,
            provides,
            subscribes: Vec::new(),
            concurrent_safe: false,
            requires_api: Vec::new(),
            verb_docs: std::collections::HashMap::new(),
            sync_verbs: Vec::new(),
            inner: PluginImpl::Component { plugin, store },
            telemetry,
            epoch_guard,
            on_event_budget_ms: DEFAULT_ON_EVENT_BUDGET_MS,
        }
    }

    pub(crate) fn new_module(
        id: String,
        instance: wasmtime::Instance,
        store: Store<P1Store>,
        telemetry: TelemetryBus,
        provides: Vec<String>,
    ) -> Self {
        // Epoch callback + baseline armed before module instantiation (see
        // new_component); just capture the guard here.
        let epoch_guard = store.data().epoch_guard.clone();
        Self {
            id,
            state: PluginState::Idle,
            provides,
            subscribes: Vec::new(),
            concurrent_safe: false,
            requires_api: Vec::new(),
            verb_docs: std::collections::HashMap::new(),
            sync_verbs: Vec::new(),
            inner: PluginImpl::Module { instance, store },
            telemetry,
            epoch_guard,
            on_event_budget_ms: DEFAULT_ON_EVENT_BUDGET_MS,
        }
    }

    /// The cancel flag shared with this plugin's store epoch callback. Flipping
    /// it (then advancing the engine epoch one tick) force-interrupts an
    /// in-flight guest call at its next epoch checkpoint.
    pub(crate) fn cancel_flag(&self) -> std::sync::Arc<std::sync::atomic::AtomicBool> {
        self.epoch_guard.cancel.clone()
    }

    /// Attach the manifest's `capabilities.subscribes` event names to this handle.
    /// A builder-style setter so the existing constructors and their callers stay
    /// unchanged (the smallest-ripple way to flow subscriptions to the router).
    pub(crate) fn with_subscribes(mut self, subscribes: Vec<String>) -> Self {
        self.subscribes = subscribes;
        self
    }

    /// Attach the manifest's `capabilities.concurrentSafe` flag. Builder-style,
    /// mirroring with_subscribes. Records the plugin's opt-in to concurrent
    /// (pooled) dispatch; the runner reads it to choose the drain strategy.
    pub(crate) fn with_on_event_budget_ms(mut self, budget_ms: u64) -> Self {
        self.on_event_budget_ms = budget_ms;
        self
    }

    pub(crate) fn with_concurrent_safe(mut self, concurrent_safe: bool) -> Self {
        self.concurrent_safe = concurrent_safe;
        self
    }

    /// Attach the manifest's `capabilities.requiresApi` (SPI consumer side).
    /// Builder-style, mirroring with_subscribes.
    pub(crate) fn with_requires_api(mut self, requires_api: Vec<String>) -> Self {
        self.requires_api = requires_api;
        self
    }

    /// Attach the manifest's `capabilities.verbDocs` (per-verb prompt prose).
    /// Builder-style, mirroring with_subscribes.
    pub(crate) fn with_verb_docs(
        mut self,
        verb_docs: std::collections::HashMap<String, String>,
    ) -> Self {
        self.verb_docs = verb_docs;
        self
    }

    /// Attach the manifest's `capabilities.syncVerbs` — the verbs this plugin serves
    /// synchronously via `respond`. Builder-style, mirroring with_subscribes. The host
    /// consults this before dispatching a synchronous respond (a verb absent here is
    /// async-only). Empty means the plugin serves nothing synchronously.
    pub(crate) fn with_sync_verbs(mut self, sync_verbs: Vec<String>) -> Self {
        self.sync_verbs = sync_verbs;
        self
    }

    /// Whether the plugin declared `verb` (a `<key>:<verb>` string) as synchronous.
    /// The host's not-supported guard: a respond dispatch to a verb not listed here is
    /// refused cleanly, never a hung async-only call.
    pub fn serves_sync(&self, verb: &str) -> bool {
        self.sync_verbs.iter().any(|v| v == verb)
    }

    fn emit_lifecycle_event(
        &self,
        stage: &'static str,
        phase: &'static str,
        extra: Option<serde_json::Value>,
    ) {
        let mut payload = serde_json::Map::new();
        payload.insert(
            "plugin_id".to_string(),
            serde_json::Value::String(self.id.clone()),
        );
        payload.insert(
            "phase".to_string(),
            serde_json::Value::String(phase.to_string()),
        );
        payload.insert(
            "stage".to_string(),
            serde_json::Value::String(stage.to_string()),
        );

        if let Some(extra) = extra {
            if let Some(extra_map) = extra.as_object() {
                for (k, v) in extra_map {
                    payload.insert(k.clone(), v.clone());
                }
            } else {
                payload.insert("details".to_string(), extra);
            }
        }

        self.telemetry.emit_named(
            format!("plugin:lifecycle:{stage}"),
            Some(self.id.clone()),
            Some(serde_json::Value::Object(payload)),
        );
    }

    // ── Typed lifecycle methods ───────────────────────────────────────────────

    /// Call the plugin's `setup()` export.
    ///
    /// For P1 modules: optional — succeeds silently if not exported.
    pub async fn call_setup(&mut self) -> Result<()> {
        self.emit_lifecycle_event("start", "setup", None);
        self.state = PluginState::Running;
        let result = match &mut self.inner {
            PluginImpl::Component { plugin, store } => plugin
                .refarm_plugin_integration()
                .call_setup(store)
                .await
                .map(|r| r.map_err(|e| anyhow::anyhow!("setup() error: {:?}", e))),
            PluginImpl::Module { instance, store } => {
                match instance.get_func(&mut *store, "setup") {
                    None => Ok(Ok(())),
                    Some(f) => {
                        let typed: wasmtime::TypedFunc<(), ()> = f.typed(&*store)?;
                        typed
                            .call(&mut *store, ())
                            .map(Ok)
                            .map_err(|e| anyhow::anyhow!("setup() trap: {e}"))
                    }
                }
            }
        };

        match result {
            Ok(Ok(())) => {
                self.state = PluginState::Idle;
                self.emit_lifecycle_event("end", "setup", None);
                Ok(())
            }
            Ok(Err(e)) => {
                self.state = PluginState::Error;
                let message = e.to_string();
                self.emit_lifecycle_event(
                    "error",
                    "setup",
                    Some(serde_json::json!({ "error": message.clone() })),
                );
                anyhow::bail!(message)
            }
            Err(e) => {
                self.state = PluginState::Error;
                let message = format!("setup() trap: {e}");
                self.emit_lifecycle_event(
                    "error",
                    "setup",
                    Some(serde_json::json!({ "error": message.clone() })),
                );
                anyhow::bail!(message)
            }
        }
    }

    /// Call the plugin's `ingest()` export. Returns the count of ingested nodes.
    ///
    /// For P1 modules: optional — returns 0 if not exported.
    pub async fn call_ingest(&mut self) -> Result<u32> {
        self.emit_lifecycle_event("start", "ingest", None);
        self.state = PluginState::Running;
        let result = match &mut self.inner {
            PluginImpl::Component { plugin, store } => plugin
                .refarm_plugin_integration()
                .call_ingest(store)
                .await
                .map(|r| r.map_err(|e| anyhow::anyhow!("ingest() error: {:?}", e))),
            PluginImpl::Module { instance, store } => {
                match instance.get_func(&mut *store, "ingest") {
                    None => Ok(Ok(0)),
                    Some(f) => {
                        let typed: wasmtime::TypedFunc<(), i32> = f.typed(&*store)?;
                        typed
                            .call(&mut *store, ())
                            .map(|n| Ok(n as u32))
                            .map_err(|e| anyhow::anyhow!("ingest() trap: {e}"))
                    }
                }
            }
        };

        match result {
            Ok(Ok(count)) => {
                self.state = PluginState::Idle;
                self.emit_lifecycle_event(
                    "end",
                    "ingest",
                    Some(serde_json::json!({ "ingested": count })),
                );
                Ok(count)
            }
            Ok(Err(e)) => {
                self.state = PluginState::Error;
                let message = e.to_string();
                self.emit_lifecycle_event(
                    "error",
                    "ingest",
                    Some(serde_json::json!({ "error": message.clone() })),
                );
                anyhow::bail!(message)
            }
            Err(e) => {
                self.state = PluginState::Error;
                let message = format!("ingest() trap: {e}");
                self.emit_lifecycle_event(
                    "error",
                    "ingest",
                    Some(serde_json::json!({ "error": message.clone() })),
                );
                anyhow::bail!(message)
            }
        }
    }

    /// Call the plugin's `teardown()` export.
    ///
    /// For P1 modules: optional — silently succeeds if not exported.
    pub async fn call_teardown(&mut self) {
        self.emit_lifecycle_event("start", "teardown", None);
        self.state = PluginState::Running;
        let result: Result<()> = match &mut self.inner {
            PluginImpl::Component { plugin, store } => plugin
                .refarm_plugin_integration()
                .call_teardown(store)
                .await
                .map_err(|e| anyhow::anyhow!("teardown() trap: {e}")),
            PluginImpl::Module { instance, store } => {
                match instance.get_func(&mut *store, "teardown") {
                    None => Ok(()),
                    Some(f) => {
                        let typed: wasmtime::TypedFunc<(), ()> = match f.typed(&*store) {
                            Ok(t) => t,
                            Err(e) => {
                                tracing::warn!(plugin_id = %self.id, "teardown() type error: {e}");
                                self.state = PluginState::Idle;
                                return;
                            }
                        };
                        typed
                            .call(&mut *store, ())
                            .map_err(|e| anyhow::anyhow!("teardown() trap: {e}"))
                    }
                }
            }
        };

        match result {
            Ok(()) => {
                self.state = PluginState::Idle;
                self.emit_lifecycle_event("end", "teardown", None);
            }
            Err(e) => {
                self.state = PluginState::Error;
                let message = e.to_string();
                self.emit_lifecycle_event(
                    "error",
                    "teardown",
                    Some(serde_json::json!({ "error": message.clone() })),
                );
                tracing::warn!(plugin_id = %self.id, "{message}");
            }
        }
    }

    /// Call the plugin's `metadata()` export.
    ///
    /// For P1 modules: returns a stub — P1 modules have no WIT metadata export.
    pub async fn call_metadata(&mut self) -> Result<serde_json::Value> {
        match &mut self.inner {
            PluginImpl::Component { plugin, store } => {
                let meta = plugin
                    .refarm_plugin_integration()
                    .call_metadata(store)
                    .await?;
                Ok(serde_json::json!({
                    "name": meta.name,
                    "version": meta.version,
                    "description": meta.description,
                    "supportedTypes": meta.supported_types,
                    "requiredCapabilities": meta.required_capabilities,
                }))
            }
            PluginImpl::Module { .. } => Ok(serde_json::json!({
                "name": self.id,
                "version": "unknown",
                "description": "P1 plain module (no WIT metadata)",
                "supportedTypes": [],
                "requiredCapabilities": [],
            })),
        }
    }

    /// Call the plugin's `on-event()` export.
    ///
    /// For P1 modules: serialises `(event, payload)` as JSON, writes it to the
    /// module's linear memory via the `alloc(len) -> ptr` export, then calls
    /// `on_event(ptr, len)`.
    pub async fn call_on_event(&mut self, event: &str, payload: Option<&str>) -> Result<()> {
        // Clear a stale cancel flag from a prior (already-resolved) call so it
        // can't spuriously trap THIS call; a cancel targets the in-flight call.
        self.epoch_guard
            .cancel
            .store(false, std::sync::atomic::Ordering::SeqCst);
        // Arm the in-flight wall-clock deadline; the per-store epoch callback
        // traps once it elapses (timeout) or the cancel flag is set (force
        // interrupt). Cleared after the call so lifecycle calls don't inherit it.
        // The budget rides on the handle (stamped from config at load), so this
        // hot path reads a field — never `std::env::var`.
        let budget_ms = self.on_event_budget_ms;
        // checked_add so a pathological budget can't overflow Instant + Duration
        // and panic INSIDE the wall_deadline lock (which would poison the guard).
        // On overflow, fall back to a far-future deadline (effectively no wall
        // timeout — the cancel flag still interrupts).
        let now = std::time::Instant::now();
        let deadline = now
            .checked_add(std::time::Duration::from_millis(budget_ms))
            .unwrap_or_else(|| now + std::time::Duration::from_secs(3600));
        *self
            .epoch_guard
            .wall_deadline
            .lock()
            .expect("wall_deadline poisoned") = Some(deadline);

        let result = match &mut self.inner {
            PluginImpl::Component { plugin, store } => plugin
                .refarm_plugin_integration()
                .call_on_event(store, event, payload)
                .await
                .map(|_| ()),
            PluginImpl::Module { instance, store } => {
                Self::call_module_on_event(&self.id, instance, store, event, payload)
            }
        };

        // Disarm the deadline regardless of outcome.
        *self
            .epoch_guard
            .wall_deadline
            .lock()
            .expect("wall_deadline poisoned") = None;
        result
    }

    /// The P1-module on_event body, factored out so call_on_event can arm/disarm
    /// the wall-clock deadline uniformly around both variants.
    fn call_module_on_event(
        id: &str,
        instance: &wasmtime::Instance,
        store: &mut Store<P1Store>,
        event: &str,
        payload: Option<&str>,
    ) -> Result<()> {
        let event_json = serde_json::json!({
            "event": event,
            "payload": payload,
        })
        .to_string();
        let len = event_json.len() as i32;

        let alloc_fn = instance
            .get_func(&mut *store, "alloc")
            .ok_or_else(|| anyhow::anyhow!("P1 module '{}' must export 'alloc(i32) -> i32'", id))?;
        let alloc: wasmtime::TypedFunc<i32, i32> = alloc_fn.typed(&*store)?;
        let ptr = alloc.call(&mut *store, len)?;

        let memory = instance
            .get_memory(&mut *store, "memory")
            .ok_or_else(|| anyhow::anyhow!("P1 module '{}' must export 'memory'", id))?;
        memory.write(&mut *store, ptr as usize, event_json.as_bytes())?;

        let on_event_fn = instance.get_func(&mut *store, "on_event").ok_or_else(|| {
            anyhow::anyhow!("P1 module '{}' must export 'on_event(i32, i32)'", id)
        })?;
        let on_event: wasmtime::TypedFunc<(i32, i32), ()> = on_event_fn.typed(&*store)?;
        on_event.call(&mut *store, (ptr, len))?;
        Ok(())
    }

    /// Call the plugin's `respond(payload) -> result<string, plugin-error>` export.
    ///
    /// Unlike `on-event` (fire-and-forget), `respond` is the SYNCHRONOUS
    /// request/response channel of the canonical `integration` interface: the host
    /// hands the guest a payload and reads its string return. This is the seam a
    /// provider-shaped plugin uses — a `source:v1` / `records:v1` provider implements
    /// `integration` and routes `respond({method:"discover"|"materialize", ...})` to a
    /// JSON result, so the host can call provider methods without a graph round-trip.
    ///
    /// Runs guest logic, so it arms the wall-clock deadline like `call_on_event`
    /// (timeout + cooperative cancel). P1 plain modules have no `respond` export → a
    /// clear error (they use `on_event` dispatch instead).
    pub async fn call_respond(&mut self, payload: &str) -> Result<String> {
        // Same epoch arming as call_on_event: clear a stale cancel, set the deadline.
        self.epoch_guard
            .cancel
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let budget_ms = self.on_event_budget_ms;
        let now = std::time::Instant::now();
        let deadline = now
            .checked_add(std::time::Duration::from_millis(budget_ms))
            .unwrap_or_else(|| now + std::time::Duration::from_secs(3600));
        *self
            .epoch_guard
            .wall_deadline
            .lock()
            .expect("wall_deadline poisoned") = Some(deadline);

        let result = match &mut self.inner {
            PluginImpl::Component { plugin, store } => plugin
                .refarm_plugin_integration()
                .call_respond(store, payload)
                .await
                .map(|r| r.map_err(|e| anyhow::anyhow!("respond() error: {:?}", e))),
            PluginImpl::Module { .. } => Ok(Err(anyhow::anyhow!(
                "plugin '{}' is a P1 plain module with no respond() export",
                self.id
            ))),
        };

        // Disarm the deadline regardless of outcome.
        *self
            .epoch_guard
            .wall_deadline
            .lock()
            .expect("wall_deadline poisoned") = None;

        match result {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(e)) => anyhow::bail!(e.to_string()),
            Err(e) => anyhow::bail!("respond() trap: {e}"),
        }
    }

    // ── Generic dispatcher (for TS-parity API) ────────────────────────────────

    /// Dispatch a named lifecycle call. Used by higher-level APIs.
    pub async fn call(
        &mut self,
        fn_name: &str,
        _args: Option<serde_json::Value>,
    ) -> Result<Option<serde_json::Value>> {
        tracing::debug!(plugin_id = %self.id, fn_name, "Plugin call");
        match fn_name {
            "setup" => {
                self.call_setup().await?;
                Ok(None)
            }
            "ingest" => {
                let n = self.call_ingest().await?;
                Ok(Some(serde_json::json!(n)))
            }
            "teardown" => {
                self.call_teardown().await;
                Ok(None)
            }
            "metadata" => {
                let m = self.call_metadata().await?;
                Ok(Some(m))
            }
            "respond" => {
                let payload = _args
                    .as_ref()
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| _args.as_ref().map(|v| v.to_string()))
                    .unwrap_or_default();
                let reply = self.call_respond(&payload).await?;
                Ok(Some(serde_json::json!(reply)))
            }
            other => anyhow::bail!("unknown plugin function: {other}"),
        }
    }

    /// Terminate the plugin and clean up resources.
    pub fn terminate(&mut self) {
        tracing::info!(plugin_id = %self.id, "Plugin terminated");
        self.state = PluginState::Idle;
    }
}

impl std::fmt::Debug for PluginInstanceHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let variant = match &self.inner {
            PluginImpl::Component { .. } => "p2-component",
            PluginImpl::Module { .. } => "p1-module",
        };
        f.debug_struct("PluginInstanceHandle")
            .field("id", &self.id)
            .field("state", &self.state)
            .field("variant", &variant)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasmtime::{Config, Engine, Instance, Module};
    use wasmtime_wasi::WasiCtxBuilder;

    fn p1_fixture_handle() -> PluginInstanceHandle {
        let engine = Engine::new(&Config::new()).expect("engine");
        let wasm = wat::parse_str(
            r#"
            (module
              (memory (export "memory") 1)
              (func (export "setup"))
              (func (export "ingest") (result i32)
                i32.const 7)
              (func (export "teardown"))
              (func (export "alloc") (param i32) (result i32)
                i32.const 16)
              (func (export "on_event") (param i32 i32)))
            "#,
        )
        .expect("wat");
        let module = Module::from_binary(&engine, &wasm).expect("module");
        // Deliberately raw Store::new, NOT new_armed_store: this fixture's engine has
        // no epoch_interruption, so there is no default-0 deadline to defuse and no
        // footgun to arm against. Routing it through the factory would be a lie.
        #[allow(clippy::disallowed_methods)]
        let mut store = Store::new(
            &engine,
            P1Store {
                wasi: WasiCtxBuilder::new().build_p1(),
                epoch_guard: EpochGuard::new(),
            },
        );
        let instance = Instance::new(&mut store, &module, &[]).expect("instance");

        PluginInstanceHandle::new_module(
            "p1-fixture".to_string(),
            instance,
            store,
            TelemetryBus::new(16),
            vec!["integration:respond".to_string()],
        )
    }

    #[tokio::test]
    async fn p1_module_dispatcher_runs_lifecycle_metadata_and_events() {
        let mut handle = p1_fixture_handle();

        handle.call_setup().await.expect("setup");
        assert_eq!(handle.state, PluginState::Idle);

        let ingested = handle.call("ingest", None).await.expect("ingest");
        assert_eq!(ingested, Some(serde_json::json!(7)));
        assert_eq!(handle.state, PluginState::Idle);

        let metadata = handle
            .call("metadata", None)
            .await
            .expect("metadata")
            .expect("metadata payload");
        assert_eq!(metadata["name"], "p1-fixture");
        assert_eq!(metadata["version"], "unknown");
        assert_eq!(metadata["requiredCapabilities"], serde_json::json!([]));

        handle
            .call_on_event("agent:resume", Some(r#"{"ok":true}"#))
            .await
            .expect("on_event");
        handle.call("teardown", None).await.expect("teardown");
        assert_eq!(handle.state, PluginState::Idle);

        let err = handle.call("missing", None).await.unwrap_err();
        assert!(err.to_string().contains("unknown plugin function: missing"));
    }
}
