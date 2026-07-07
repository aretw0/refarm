//! tractor-native — Sovereign WASM plugin host
//!
//! Native Rust implementation of the Refarm Tractor. Designed for:
//!   - Edge / RPi agents (~10 MB binary, no Node.js/V8)
//!   - Electron desktop applications (embedded library)
//!   - Server-side plugin orchestration
//!
//! Provides full behavioral parity with `@refarm.dev/tractor` (TypeScript).
//! Uses the same SQLite schema and Loro CRDT binary format, enabling data
//! portability between browser (JS) and native (Rust) runtimes.
//!
//! # Architecture
//!
//! ```text
//! TractorNative
//!   ├── host::PluginHost       — wasmtime Component loader + WIT bridge
//!   ├── storage::NativeStorage — rusqlite, same schema as storage-sqlite TS
//!   ├── sync::NativeSync       — loro::LoroDoc CQRS + Projector
//!   ├── trust::TrustManager    — PluginTrustGrant + ExecutionProfile
//!   └── telemetry::TelemetryBus — tokio broadcast fan-out + RingBuffer
//! ```
//!
//! # Session Continuity
//! See `README.md` for phase checklist and instructions to resume from another session.

pub mod capabilities;
pub mod daemon;
pub mod host;
pub mod node_reap;
pub mod observer;
pub mod sidecar;
pub mod storage;
pub(crate) mod streaming;
pub mod sync;
pub mod telemetry;
pub mod trust;

/// Shared test-only helpers for the whole crate. Kept behind `#[cfg(test)]` so it
/// never ships in the daemon binary.
#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// Serialize any test that mutates process env. `std::env::set_var` is
    /// process-global and leaks across threads under `--test-threads>1`, so every
    /// env-touching test in the crate takes THIS one lock (a single lane) instead
    /// of a per-module copy. Recovers from a poisoned lock (a panicking test holding
    /// the guard) rather than cascade-panicking every subsequent env test — the
    /// half-fix that used to live in only two of the five copies.
    pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use tokio::sync::mpsc;

pub use storage::NativeStorage;
pub use sync::NativeSync;
pub use telemetry::TelemetryBus;
pub use trust::{ExecutionProfile, SecurityMode, TrustManager};

/// A neutral event envelope routed to a loaded plugin's runner. `event` is the
/// event name (e.g. `user:prompt`, `vault:dispatch`); `payload` is an opaque
/// JSON string. Nothing here is agent-specific — the agent is just one plugin
/// whose events happen to be `user:prompt`. (Formerly `AgentMessage`; the neutral
/// name reflects that any plugin, not only the agent, is driven through this.)
///
/// `reply` distinguishes the two dispatch shapes of ADR-084. `None` is the
/// async default: the runner calls `on-event` (fire-and-forget), the result comes
/// back out-of-band through the bridge. `Some(tx)` is the synchronous, capability-
/// negotiated `respond` path: the runner calls `respond` and sends the string reply
/// (or an error message) back through the oneshot, so a caller awaits a typed return
/// in-band. Only plugins advertising `sync:<verb>` in `metadata()` are dispatched this
/// way — the host enforces the flag before minting a reply-bearing envelope.
#[derive(Debug)]
pub struct EventEnvelope {
    pub event: String,
    pub payload: Option<String>,
    pub reply: Option<tokio::sync::oneshot::Sender<Result<String, String>>>,
}

impl EventEnvelope {
    /// The async-default envelope: fire-and-forget `on-event`, no reply channel.
    pub fn fire(event: impl Into<String>, payload: Option<String>) -> Self {
        Self { event: event.into(), payload, reply: None }
    }

    /// The synchronous `respond` envelope: carries a oneshot the runner satisfies by
    /// calling `respond` and sending back its string reply (or error message). The
    /// runner branches on `reply.is_some()` and ignores `event` for this path, so the
    /// event is a documentation sentinel, not a routed event name.
    pub fn respond_request(
        payload: Option<String>,
        reply: tokio::sync::oneshot::Sender<Result<String, String>>,
    ) -> Self {
        Self { event: RESPOND_REQUEST_EVENT.to_string(), payload, reply: Some(reply) }
    }
}

/// Sentinel `event` for a synchronous respond envelope. The runner never routes on it
/// (it branches on the presence of a reply channel); it exists only so a respond
/// envelope reads as a respond, not a borrowed `user:prompt`.
const RESPOND_REQUEST_EVENT: &str = "__tractor:respond";

const SHUTDOWN_EVENT: &str = "__tractor:shutdown";

/// The event a plugin declaring `integration:respond` is implicitly subscribed to (the
/// agent's prompt channel). `integration:respond` is sugar that expands to this
/// subscription plus election as the default `user:prompt` target.
const USER_PROMPT_EVENT: &str = "user:prompt";

/// Keyed by plugin_id — each sender reaches the plugin's dedicated runner thread.
pub type PluginChannels = Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EventEnvelope>>>>;

/// Keyed by plugin_id — the cancel flag shared with each plugin store's epoch
/// callback. Setting a flag force-interrupts that plugin's in-flight guest call
/// at the next epoch tick (the global ticker wakes the callback within ~1ms).
/// This is how effort-cancel reaches a thread already spinning inside a guest,
/// which the mpsc PluginChannels above cannot (the wedged thread never polls it).
pub type CancelFlags =
    Arc<RwLock<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>>;

/// Keyed by prompt_ref — the cancel flag of the SPECIFIC store currently running
/// that prompt. A runner registers this the instant it dequeues a prompt (before
/// entering the guest) and clears it when the call returns. Effort-cancel derives
/// the prompt_ref from the effort_id and flips exactly this flag, so with a store
/// POOL (N stores draining one queue) a cancel interrupts only the store running
/// the target effort — not the N-1 neighbours running unrelated events. Only the
/// respond family carries a prompt_ref and can sit in-progress awaiting cancel;
/// event dispatch is terminal-on-delivery and never needs this.
pub type InFlightCancels =
    Arc<RwLock<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>>;

/// The neutral event router: maps an event name to the set of plugin_ids
/// subscribed to it, layered OVER the plugin-id lifecycle registry
/// (`plugin_channels`) rather than replacing it — the registry still owns the
/// senders and shutdown drain. This is what makes any loaded plugin able to
/// receive its OWN declared event, not just the elected agent's `user:prompt`.
///
/// A plugin declares its events via `capabilities.subscribes` in its manifest;
/// the legacy `integration:respond` and `observe-host-effects` capability strings are
/// treated as sugar that expand into subscriptions (see `register_for_events`),
/// so no existing manifest has to change.
#[derive(Clone, Default)]
pub struct EventRouter {
    /// event name -> set of subscribed plugin_ids.
    index: Arc<RwLock<HashMap<String, std::collections::BTreeSet<String>>>>,
}

impl EventRouter {
    /// Subscribe a plugin to an event name (idempotent).
    pub fn subscribe(&self, event: &str, plugin_id: &str) {
        self.index
            .write()
            .expect("event router poisoned")
            .entry(event.to_string())
            .or_default()
            .insert(plugin_id.to_string());
    }

    /// Remove a plugin from every event's subscriber set (on teardown/unload).
    pub fn unsubscribe_all(&self, plugin_id: &str) {
        let mut index = self.index.write().expect("event router poisoned");
        for subscribers in index.values_mut() {
            subscribers.remove(plugin_id);
        }
        index.retain(|_, subscribers| !subscribers.is_empty());
    }

    /// The plugin_ids subscribed to `event`, in stable order.
    pub fn subscribers(&self, event: &str) -> Vec<String> {
        self.index
            .read()
            .expect("event router poisoned")
            .get(event)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// True when at least one plugin is subscribed to `event`.
    pub fn has_subscribers(&self, event: &str) -> bool {
        self.index
            .read()
            .expect("event router poisoned")
            .get(event)
            .is_some_and(|s| !s.is_empty())
    }
}

/// Deliver an event to plugin runner channels via the router, emitting the
/// `router:deliver` observability event. The one shared implementation both
/// `TractorNative::deliver` and the sidecar effort dispatcher call, so routing +
/// its telemetry live in ONE place. `Some(target)` delivers to exactly that
/// plugin; `None` broadcasts to every subscriber of `event`. Returns the count
/// actually sent.
pub fn deliver_via_router(
    router: &EventRouter,
    channels: &PluginChannels,
    telemetry: &TelemetryBus,
    event: &str,
    target: Option<&str>,
    payload: Option<String>,
) -> usize {
    let started = std::time::Instant::now();
    let recipients: Vec<String> = match target {
        Some(plugin_id) => vec![plugin_id.to_string()],
        None => router.subscribers(event),
    };
    let wanted = recipients.len();
    let mut sent = 0;
    if wanted > 0 {
        let guard = channels.read().expect("plugin_channels poisoned");
        for plugin_id in &recipients {
            if let Some(tx) = guard.get(plugin_id) {
                if tx
                    .send(EventEnvelope::fire(event.to_string(), payload.clone()))
                    .is_ok()
                {
                    sent += 1;
                }
            }
        }
    }

    // This is the ENQUEUE time only — the message is now buffered on the target's
    // channel, NOT executed. The real per-event execution cost + the head-of-line
    // queue depth are emitted as `plugin:on_event` from the runner thread, where
    // the work actually runs. Named `enqueue_us` so no reader mistakes it for the
    // end-to-end latency (the old `latency_us` name did exactly that).
    let enqueue_us = started.elapsed().as_micros() as u64;
    // `undeliverable` is the degradation signal: events with no subscriber, or
    // subscribers whose sender was gone. Watch this in telemetry.
    let undeliverable = wanted.saturating_sub(sent);
    telemetry.emit_named(
        "router:deliver",
        None,
        Some(serde_json::json!({
            "event": event,
            "target": target,
            "wanted": wanted,
            "sent": sent,
            "undeliverable": undeliverable,
            "enqueue_us": enqueue_us,
        })),
    );
    if undeliverable > 0 {
        tracing::warn!(
            event = %event,
            wanted,
            sent,
            undeliverable,
            "router: some recipients were undeliverable"
        );
    }
    sent
}

/// Extract the `prompt_ref` from a runner message's JSON payload, if present.
/// Only respond (`user:prompt`) payloads carry it (dispatch.rs stamps it,
/// derived from the effort_id). Used to key the in-flight cancel map so a cancel
/// targets the exact store running that prompt.
fn prompt_ref_from_payload(payload: Option<&str>) -> Option<String> {
    let raw = payload?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value
        .get("prompt_ref")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// The opt-in pool size for a concurrent-safe plugin, from REFARM_PLUGIN_POOL.
/// 1 (default / unset / invalid) keeps the single-store runner. Capped at 16 to
/// stay well under the 8GB host ceiling even before the bounded pooling
/// allocator lands.
/// Parse `REFARM_PLUGIN_POOL` from the process env. Called ONCE at boot via
/// [`TractorNativeConfig::from_env`]; the resolved value then rides on the config
/// and is read from there (never from env on any hot path).
fn plugin_pool_size_from_env() -> usize {
    std::env::var("REFARM_PLUGIN_POOL")
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1)
        .min(16)
}

/// Parse `REFARM_ON_EVENT_TIMEOUT_MS` from the process env. Called ONCE at boot
/// via [`TractorNativeConfig::from_env`]; the resolved value rides on the config
/// into every `PluginInstanceHandle`, so the per-event hot path reads a field,
/// not env.
/// Max event budget (ms). Clamped so a huge `REFARM_ON_EVENT_TIMEOUT_MS` can't
/// overflow `Instant + Duration` on the hot path (which would panic inside the
/// wall_deadline lock and poison the guard). 24h is far beyond any real budget.
const MAX_ON_EVENT_BUDGET_MS: u64 = 24 * 60 * 60 * 1_000;

fn on_event_budget_ms_from_env() -> u64 {
    std::env::var("REFARM_ON_EVENT_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(2_000)
        .min(MAX_ON_EVENT_BUDGET_MS)
}

/// Spawn one runner thread that owns `handle`'s !Send store and drains the
/// shared receiver. For the default single-store path there is exactly one of
/// these; for a concurrent-safe pooled plugin there are N, all draining the same
/// queue in parallel (each pinned to its own thread, satisfying !Send).
///
/// Each thread takes a message under the shared-rx lock, releases the lock, then
/// runs the guest — so N guests execute concurrently while only the brief
/// dequeue is serialized. A `None` recv (senders dropped at shutdown) or a
/// SHUTDOWN_EVENT tears this runner down.
/// Project a TERMINAL ERROR result node for a respond whose guest errored, so the
/// terminal-result watcher finalises the effort `failed` immediately (with the
/// real error) instead of polling to a 45s false `timed-out`. Uses the SAME
/// generic shape the watcher matches (AgentResponse / prompt_ref / is_final) plus
/// `is_error: true` and the error text as `content`. Best-effort: a store failure
/// is logged, not fatal (the watcher then falls back to its timeout, no worse
/// than before this fix).
fn write_terminal_error_result(sync: &NativeSync, plugin_id: &str, prompt_ref: &str, error: &str) {
    let id = format!("urn:result:error:{prompt_ref}");
    let payload = serde_json::json!({
        "@type": "Response",
        "@id": id,
        "prompt_ref": prompt_ref,
        "content": error,
        "is_final": true,
        "is_error": true,
    })
    .to_string();
    if let Err(e) = sync.store_node(&id, "Response", None, &payload, Some(plugin_id)) {
        tracing::warn!(
            plugin_id = %plugin_id,
            prompt_ref = %prompt_ref,
            "failed to project terminal error result (watcher will fall back to timeout): {e}"
        );
    }
}

fn spawn_plugin_store_runner(
    handle: host::PluginInstanceHandle,
    shared_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<EventEnvelope>>>,
    telemetry: TelemetryBus,
    plugin_id: String,
    store_cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    in_flight: InFlightCancels,
    sync: NativeSync,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("plugin runner rt");
        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            let mut h = handle;
            let mut teardown_done = false;
            loop {
                // Take one message (and read the backlog behind it) under the
                // lock, then release so other pool workers can dequeue while this
                // one runs its guest.
                let (msg, queue_depth) = {
                    let mut rx = shared_rx.lock().await;
                    let depth = rx.len();
                    match rx.recv().await {
                        Some(msg) => (msg, depth),
                        None => break, // senders dropped — shutdown.
                    }
                };
                if msg.event == SHUTDOWN_EVENT {
                    h.call_teardown().await;
                    teardown_done = true;
                    break;
                }

                // ADR-084 synchronous `respond`: a reply-bearing envelope is served by
                // `call_respond` (not `call_on_event`), and its string return is sent
                // back in-band through the oneshot. This is the ONLY place the runner
                // calls respond — reached solely for plugins the host verified advertise
                // `sync:<verb>`, so an async-only plugin is never driven this way.
                if let Some(reply) = msg.reply {
                    let payload = msg.payload.unwrap_or_default();
                    let result = h.call_respond(&payload).await.map_err(|e| e.to_string());
                    // The receiver may have dropped (caller gave up / timed out); a
                    // failed send is not the runner's problem.
                    let _ = reply.send(result);
                    continue;
                }

                // Precise cancel: register THIS store's cancel flag under the
                // prompt_ref it is about to run, so effort-cancel interrupts only
                // this store (not the pool's other workers). Cleared after the
                // call. Only respond payloads carry prompt_ref; others skip it.
                let prompt_ref = prompt_ref_from_payload(msg.payload.as_deref());
                if let Some(pr) = &prompt_ref {
                    in_flight
                        .write()
                        .expect("in_flight_cancels poisoned")
                        .insert(pr.clone(), store_cancel.clone());
                }

                let started = std::time::Instant::now();
                let outcome = h.call_on_event(&msg.event, msg.payload.as_deref()).await;
                let exec_us = started.elapsed().as_micros() as u64;

                // Deregister the prompt_ref — the call is done (or trapped).
                if let Some(pr) = &prompt_ref {
                    in_flight
                        .write()
                        .expect("in_flight_cancels poisoned")
                        .remove(pr);
                }
                // An epoch trap (deadline exceeded) surfaces as Trap::Interrupt
                // inside the anyhow error. Classify it so a wedged/interrupted
                // handler is observable as a timeout, not a generic error.
                let timed_out = outcome.as_ref().err().is_some_and(|e| {
                    e.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::Interrupt)
                });
                if let Err(e) = &outcome {
                    if timed_out {
                        tracing::warn!(
                            plugin_id = %plugin_id,
                            event = %msg.event,
                            "on_event timed out (epoch interrupt) — tearing down runner"
                        );
                    } else {
                        tracing::warn!(plugin_id = %plugin_id, "on_event error: {e}");
                        // For a respond (prompt_ref present) that errored — not an
                        // epoch timeout — the guest wrote no terminal result, so the
                        // terminal-result watcher would otherwise poll to its 45s
                        // deadline and report a FALSE `timed-out`. Project a terminal
                        // ERROR result node (the generic shape the watcher matches:
                        // AgentResponse / prompt_ref / is_final, + is_error) so the
                        // effort finalises `failed` immediately with the real error.
                        if let Some(pr) = &prompt_ref {
                            write_terminal_error_result(&sync, &plugin_id, pr, &e.to_string());
                        }
                    }
                }
                // Emit the REAL per-event drain cost + the queue depth behind it.
                telemetry.emit_named(
                    "plugin:on_event",
                    Some(plugin_id.clone()),
                    Some(serde_json::json!({
                        "event": msg.event,
                        "exec_us": exec_us,
                        "queue_depth": queue_depth,
                        "ok": outcome.is_ok(),
                        // `timeout` when the epoch deadline tripped, else null.
                        "reason": if timed_out { Some("timeout") } else { None::<&str> },
                    })),
                );

                // After an epoch trap the store was unwound mid-execution and is
                // not safe to reuse — tear THIS runner down. Other pool workers
                // keep serving on their own (intact) stores.
                if timed_out {
                    break;
                }
            }

            if !teardown_done {
                h.call_teardown().await;
            }
            h.terminate();
            tracing::debug!(plugin_id = %plugin_id, "plugin runner exiting");
        });
    })
}

/// Top-level configuration for booting a TractorNative instance.
///
/// Runtime knobs (pool size, event budget, …) live here as plain fields so the
/// host reads them from config, NOT from process-global `std::env::var` on hot
/// paths. `Default` is pure (deterministic literals) so tests construct a config
/// directly and never mutate process env — which leaks across threads under
/// `--test-threads>1`. Production seeds the env-overridable knobs once at boot
/// via [`TractorNativeConfig::from_env`].
#[derive(Debug, Clone)]
pub struct TractorNativeConfig {
    /// Storage namespace — maps to `~/.local/share/refarm/{namespace}.db`
    /// Use `:memory:` for ephemeral / test sessions.
    pub namespace: String,
    /// WebSocket daemon port (default: 42000, same as farmhand)
    pub port: u16,
    /// Security mode for node signing and verification
    pub security_mode: SecurityMode,
    /// Telemetry ring buffer capacity (default: 1000)
    pub telemetry_capacity: usize,
    /// Store-pool size for concurrent-safe plugins (default 1, capped 16).
    /// Env override at boot: `REFARM_PLUGIN_POOL`.
    pub plugin_pool_size: usize,
    /// Wall-clock budget (ms) for a single plugin `on_event` call; the per-store
    /// epoch callback traps a wedged guest once it elapses (default 2000).
    /// Env override at boot: `REFARM_ON_EVENT_TIMEOUT_MS`.
    pub on_event_budget_ms: u64,
}

impl Default for TractorNativeConfig {
    fn default() -> Self {
        Self {
            namespace: "default".to_string(),
            port: 42000,
            security_mode: SecurityMode::Strict,
            telemetry_capacity: 1000,
            plugin_pool_size: 1,
            on_event_budget_ms: 2_000,
        }
    }
}

impl TractorNativeConfig {
    /// A default config with the env-overridable runtime knobs seeded from the
    /// process environment. Called ONCE at boot; everything downstream reads the
    /// resolved values from the config, never from env. Non-env fields keep their
    /// `Default` values (callers override namespace/port/etc. as usual).
    pub fn from_env() -> Self {
        Self {
            plugin_pool_size: plugin_pool_size_from_env(),
            on_event_budget_ms: on_event_budget_ms_from_env(),
            ..Self::default()
        }
    }
}

/// A sovereign WASM plugin host — native Rust.
///
/// Mirrors `Tractor` class from `@refarm.dev/tractor` (TypeScript).
pub struct TractorNative {
    pub storage: NativeStorage,
    pub sync: NativeSync,
    pub plugins: host::PluginHost,
    pub trust: TrustManager,
    pub telemetry: TelemetryBus,
    /// mpsc senders to plugin runner threads, keyed by plugin_id.
    /// Populated by `register_for_events`; read by WsServer for prompt routing.
    pub plugin_channels: PluginChannels,
    /// Subset of `plugin_channels` containing only plugins that declared
    /// the `"observe-host-effects"` capability in their manifest.
    /// Read by the Scarecrow audit subscriber to route host-effect events.
    pub observer_channels: PluginChannels,
    /// Cancel flags keyed by plugin_id, shared with each plugin store's epoch
    /// callback. Populated by `register_for_events`; read by the sidecar's
    /// effort-cancel to force-interrupt a wedged guest.
    pub cancel_flags: CancelFlags,
    /// Per-prompt_ref cancel flags for precise effort→store targeting (see
    /// InFlightCancels). Populated by the runner threads as they run each prompt.
    pub in_flight_cancels: InFlightCancels,
    /// ID of the first loaded plugin that declared `"integration:respond"` capability.
    /// The sidecar exposes this as `defaultResponder` in the /plugins response so the
    /// CLI can select the active agent without hardcoding any plugin name.
    pub default_responder_id: Arc<RwLock<Option<String>>>,
    /// The neutral event router: event name -> subscribed plugin_ids. Layered over
    /// `plugin_channels`; lets any loaded plugin receive its own declared event, not
    /// just the elected agent's `user:prompt`. Populated by `register_for_events`.
    pub event_router: EventRouter,
    /// The shared registry of loaded plugins' capability profiles (provides/subscribes),
    /// populated at `register_for_events` beside the router. Shared (same Arc) with the
    /// PluginHost so a plugin's host-call can list/invoke sibling verbs (agent leg #6)
    /// and resolve `get_plugin_api`. A plugin absent here (never loaded / revoked /
    /// unloaded) is invisible to those paths — tool eligibility composes with the grant.
    pub plugin_registry: host::PluginRegistry,
    /// Join handles for plugin runner threads, keyed by plugin_id.
    /// Runner threads per plugin. A default plugin has one; a concurrent-safe
    /// plugin running with a store pool has N (one per store). All are joined on
    /// shutdown.
    plugin_runner_handles: Arc<RwLock<HashMap<String, Vec<std::thread::JoinHandle<()>>>>>,
    /// Extra store instances staged for a plugin's pool, keyed by plugin_id. The
    /// caller loads N-1 additional stores (async) via `stage_pool_stores`;
    /// register_for_events drains them into the pool. Empty for the default path.
    ///
    /// A `Mutex`, not `RwLock`: a `PluginInstanceHandle` owns a `wasmtime::Store`
    /// which is `Send` but `!Sync`, so `RwLock<Vec<Handle>>` would be `!Sync` and
    /// its `Arc` would provide no cross-thread capability. `Mutex<T>: Sync` needs
    /// only `T: Send`, which holds — and staging/draining are exclusive writes
    /// anyway, so the read-parallelism of an RwLock buys nothing here.
    pool_stores: Arc<Mutex<HashMap<String, Vec<host::PluginInstanceHandle>>>>,
    /// The on-disk path each loaded plugin came from, keyed by plugin_id. Retained
    /// by load_plugin so reload_plugin can re-read the (possibly rebuilt) bytes.
    plugin_paths: Arc<RwLock<HashMap<String, std::path::PathBuf>>>,
    #[allow(dead_code)]
    config: TractorNativeConfig,
}

impl TractorNative {
    /// Boot a TractorNative instance.
    ///
    /// Opens (or creates) the SQLite database, initialises the Loro CRDT doc,
    /// and prepares the wasmtime plugin host.
    ///
    /// Mirrors: `Tractor.boot(config)` in TypeScript.
    pub async fn boot(config: TractorNativeConfig) -> Result<Self> {
        tracing::info!(namespace = %config.namespace, "TractorNative booting");

        let telemetry = TelemetryBus::new(config.telemetry_capacity);
        let storage = NativeStorage::open(&config.namespace)?;
        let sync = NativeSync::new(storage.clone(), &config.namespace)?;
        // Honor the configured security posture (main.rs resolves Strict by
        // default). This was hardcoded to TrustManager::new() (= None), silently
        // discarding config.security_mode — so a Strict daemon ran with NO trust
        // enforcement. Now safe to honor: under Strict, the load gate admits a
        // plugin that is trust-granted OR listed in the sovereign trusted_plugins
        // allowlist (`*` = all), and stays permissive when the allowlist is absent
        // — so enabling Strict does not deny an operator who hasn't configured one.
        let trust = TrustManager::with_security_mode(config.security_mode.clone());

        // The cross-plugin seam (agent leg #6 + `get_plugin_api`): the registry of
        // loaded plugins + the router handles are created HERE, before the host, so
        // the SAME Arc-shared instances flow into both the host (via
        // `with_cross_plugin`, so a plugin's host-call can list/invoke siblings) and
        // this struct (which populates them at `register_for_events`). Sharing the
        // instances — not copies — is what makes a plugin loaded later visible to a
        // tool call made now.
        let plugin_registry = host::PluginRegistry::default();
        let plugin_channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
        let event_router = EventRouter::default();
        let cross_plugin = host::CrossPluginAccess {
            registry: plugin_registry.clone(),
            event_router: event_router.clone(),
            plugin_channels: plugin_channels.clone(),
        };
        let plugins =
            host::PluginHost::new(trust.clone(), telemetry.clone(), config.on_event_budget_ms)?
                .with_cross_plugin(cross_plugin);

        // Reclaim the unbounded streaming graph nodes (one row per streamed chunk)
        // in the background, deleting from both sqlite and the Loro doc so a
        // re-projection can't resurrect them. Self-terminates when `sync` drops.
        // Reaper knobs resolved from env ONCE here at boot.
        node_reap::spawn_node_reaper(&sync, node_reap::NodeReaperConfig::from_env());

        Ok(Self {
            storage,
            sync,
            plugins,
            trust,
            telemetry,
            plugin_channels,
            observer_channels: Arc::new(RwLock::new(HashMap::new())),
            cancel_flags: Arc::new(RwLock::new(HashMap::new())),
            in_flight_cancels: Arc::new(RwLock::new(HashMap::new())),
            default_responder_id: Arc::new(RwLock::new(None)),
            event_router,
            plugin_registry,
            plugin_runner_handles: Arc::new(RwLock::new(HashMap::new())),
            pool_stores: Arc::new(Mutex::new(HashMap::new())),
            plugin_paths: Arc::new(RwLock::new(HashMap::new())),
            config,
        })
    }

    /// Load and instantiate a WASM plugin from a file path.
    pub async fn load_plugin(&self, path: &Path) -> Result<host::PluginInstanceHandle> {
        let handle = self.plugins.load(path, &self.sync).await?;
        // Remember where this plugin came from so reload_plugin can re-read it.
        self.plugin_paths
            .write()
            .expect("plugin_paths poisoned")
            .insert(handle.id.clone(), path.to_path_buf());
        Ok(handle)
    }

    /// Load a plugin by its content hash from the content-addressed store (E3):
    /// `<assets_dir>/<hash>` holds the `.wasm` bytes a device stored at install (E2).
    /// This closes grant → hash → bytes: a device with a replicated grant that references
    /// a plugin by hash but has no local install dir can materialize the artifact from
    /// the (local or org-synced) content-store and load it.
    ///
    /// Following the skills content-addressing pattern, the split is: the MANIFEST is the
    /// POINTER (it travels with the grant / as a node — it carries the id, declared
    /// permissions, integrity, capabilities), and the WASM BYTES are content-addressed.
    /// So this takes both: the bytes are resolved by `hash` from the store; `manifest` is
    /// the plugin.json to pair with them. The host materializes an install dir with BOTH
    /// (plugin.wasm + plugin.json), then loads it — so id/permissions/integrity are
    /// correct, exactly as a local install would be.
    ///
    /// The hash IS the integrity: the bytes are verified to hash back to `hash` before
    /// loading — the store may hold bytes from any origin (a synced dir, a future peer
    /// download), so a tampered/corrupt entry whose contents don't match is REJECTED,
    /// never loaded (mirroring createFsAssetResolver's invariant + E1's load-time check).
    pub async fn load_plugin_by_hash(
        &self,
        assets_dir: &Path,
        hash: &str,
        manifest: &str,
    ) -> Result<host::PluginInstanceHandle> {
        let store_path = assets_dir.join(hash);
        let bytes = tokio::fs::read(&store_path).await.with_context(|| {
            format!("content-store miss for hash {hash} at {}", store_path.display())
        })?;
        let computed = {
            use sha2::{Digest, Sha256};
            hex::encode(Sha256::digest(&bytes))
        };
        anyhow::ensure!(
            computed == hash.trim().to_ascii_lowercase(),
            "content-store entry for {hash} hashes to {computed} — rejected (tampered or corrupt)"
        );

        // Materialize an install dir with the manifest (pointer) + the verified bytes,
        // so read_runtime_plugin_manifest finds plugin.json beside plugin.wasm and the
        // plugin loads with its real id/permissions — not the hash-as-id fallback.
        let dir = tempfile::Builder::new()
            .prefix("refarm-cas-")
            .tempdir()
            .context("materialize content-store plugin dir")?;
        let wasm_path = dir.path().join("plugin.wasm");
        tokio::fs::write(&wasm_path, &bytes).await.context("write materialized plugin.wasm")?;
        tokio::fs::write(dir.path().join("plugin.json"), manifest)
            .await
            .context("write materialized plugin.json")?;

        // The dir must outlive the load (load reads the files); keep it until after.
        let handle = self.load_plugin(&wasm_path).await;
        drop(dir);
        handle
    }

    /// Hot-reload a loaded plugin from its original path: unregister the running
    /// instance(s), load the (possibly rebuilt) bytes fresh — the content-
    /// addressed cache recompiles automatically if the bytes changed — and
    /// register the new instance. Returns Ok(false) if the plugin isn't loaded or
    /// its path wasn't retained (e.g. loaded before this ran). The plugin is
    /// briefly absent between unregister and register; events dispatched in that
    /// window are dropped by the router (no subscriber), same as before load.
    pub async fn reload_plugin(&self, plugin_id: &str) -> Result<bool> {
        let path = self
            .plugin_paths
            .read()
            .expect("plugin_paths poisoned")
            .get(plugin_id)
            .cloned();
        let Some(path) = path else {
            return Ok(false);
        };
        if !self.unregister(plugin_id).await {
            return Ok(false);
        }
        let handle = self.load_plugin(&path).await?;
        // Re-stage the pool if the plugin opted in (mirrors the boot path). The
        // fresh handle already carries subscriptions/provides from the manifest;
        // register wires them back into the router.
        self.stage_pool_stores(&path, handle.concurrent_safe).await?;
        self.register_for_events(handle);
        tracing::info!(plugin_id, path = %path.display(), "plugin hot-reloaded");
        Ok(true)
    }

    /// Load and stage the extra store instances for a concurrent-safe plugin's
    /// pool. Call this (with the plugin's path) BEFORE register_for_events when
    /// the plugin declared concurrentSafe and REFARM_PLUGIN_POOL=N>1; it loads the
    /// N-1 additional stores and stages them under the plugin_id. register_for_events
    /// then drains them into the pool. A no-op if the plugin isn't concurrent-safe
    /// or the pool size is 1.
    pub async fn stage_pool_stores(&self, path: &Path, concurrent_safe: bool) -> Result<()> {
        let pool_size = self.config.plugin_pool_size;
        if !concurrent_safe || pool_size <= 1 {
            return Ok(());
        }
        // Load N-1 extra stores (the primary store is the handle passed to
        // register_for_events). Each is an independent instance of the same
        // plugin; safe only because concurrent-safe plugins keep no cross-event
        // state in the store.
        let mut extras = Vec::with_capacity(pool_size - 1);
        let mut plugin_id: Option<String> = None;
        for _ in 1..pool_size {
            let handle = self.plugins.load(path, &self.sync).await?;
            plugin_id = Some(handle.id.clone());
            extras.push(handle);
        }
        if let Some(plugin_id) = plugin_id {
            self.pool_stores
                .lock()
                .expect("pool_stores poisoned")
                .entry(plugin_id)
                .or_default()
                .extend(extras);
        }
        Ok(())
    }

    /// Take any staged extra pool stores for a plugin (drains them from the
    /// staging map). Returns empty if none were staged.
    fn take_pool_stores(&self, plugin_id: &str) -> Vec<host::PluginInstanceHandle> {
        self.pool_stores
            .lock()
            .expect("pool_stores poisoned")
            .remove(plugin_id)
            .unwrap_or_default()
    }

    /// Move a loaded plugin handle into a dedicated runner thread and register
    /// its mpsc sender in `plugin_channels` for WebSocket prompt routing.
    ///
    /// `PluginInstanceHandle` is `!Send` (wasmtime Store). Each plugin gets its
    /// own thread + single-threaded tokio runtime so the `!Send` constraint is
    /// satisfied without unsafe code. A concurrent-safe plugin with staged pool
    /// stores (see stage_pool_stores) gets N threads sharing one queue.
    pub fn register_for_events(&self, handle: host::PluginInstanceHandle) {
        let plugin_id = handle.id.clone();
        let provides = handle.provides.clone();
        let subscribes = handle.subscribes.clone();
        let requires_api = handle.requires_api.clone();
        let verb_docs = handle.verb_docs.clone();
        let sync_verbs = handle.sync_verbs.clone();
        // Register the plugin's cancel flag (shared with its store epoch callback)
        // BEFORE the handle moves into the runner thread, so effort-cancel can
        // force-interrupt a wedged guest that never polls its mpsc channel.
        self.cancel_flags
            .write()
            .expect("cancel_flags poisoned")
            .insert(plugin_id.clone(), handle.cancel_flag());
        let (tx, rx) = mpsc::unbounded_channel::<EventEnvelope>();
        // The receiver is shared behind an async Mutex so that, for a
        // concurrent-safe plugin, a POOL of runner threads (each with its own
        // !Send store) can drain the same queue in parallel — collapsing the
        // head-of-line stall. For the default single-store path there is exactly
        // one runner and the Mutex is uncontended.
        let shared_rx = Arc::new(tokio::sync::Mutex::new(rx));

        // Pool size: 1 (default) keeps the exact single-store runner. Opt-in to N
        // ONLY when the plugin declared concurrentSafe AND REFARM_PLUGIN_POOL=N>1.
        // A stateful plugin (concurrent_safe=false) is never pooled — N stores
        // would diverge. Extra stores beyond the first are loaded by the caller
        // (async) and handed in via with_pool_stores; here we spawn one runner
        // per store, all sharing shared_rx.
        let mut extra_stores = self.take_pool_stores(&plugin_id);
        let pool_size = if handle.concurrent_safe {
            1 + extra_stores.len()
        } else {
            extra_stores.clear();
            1
        };
        let telemetry = self.telemetry.clone();

        // Spawn the primary runner (owns the handle we were given) plus one per
        // extra store. All drain shared_rx; the OS balances them across the
        // messages. Each JoinHandle is retained for shutdown. Each runner gets its
        // OWN store cancel flag + the shared in_flight map, so it can register the
        // prompt it is running for precise effort→store cancellation.
        let in_flight = self.in_flight_cancels.clone();
        let mut joins = Vec::with_capacity(pool_size);
        let primary_cancel = handle.cancel_flag();
        joins.push(spawn_plugin_store_runner(
            handle,
            shared_rx.clone(),
            telemetry.clone(),
            plugin_id.clone(),
            primary_cancel,
            in_flight.clone(),
            self.sync.clone(),
        ));
        for extra in extra_stores.drain(..) {
            let extra_cancel = extra.cancel_flag();
            joins.push(spawn_plugin_store_runner(
                extra,
                shared_rx.clone(),
                telemetry.clone(),
                plugin_id.clone(),
                extra_cancel,
                in_flight.clone(),
                self.sync.clone(),
            ));
        }
        if pool_size > 1 {
            tracing::info!(plugin_id = %plugin_id, pool_size, "plugin running with a concurrent store pool");
        }

        self.plugin_channels
            .write()
            .expect("plugin_channels poisoned")
            .insert(plugin_id.clone(), tx.clone());

        // Record the plugin's capability profile in the shared registry, beside the
        // channel + router population — one load point owns "this plugin is here and
        // declares X". The agent leg's `list-tools`/`invoke-tool` and `get_plugin_api`
        // read it; a plugin removed from here (on unload) stops being listable at once.
        self.plugin_registry
            .register(&plugin_id, provides.clone(), subscribes.clone(), verb_docs, sync_verbs);
        self.plugin_registry
            .record_requires_api(&plugin_id, requires_api);

        // Populate the neutral event router. A plugin's explicitly declared
        // `capabilities.subscribes` events are subscribed directly...
        for event in &subscribes {
            self.event_router.subscribe(event, &plugin_id);
        }

        // ...and the legacy capability strings are treated as SUGAR that expand
        // into subscriptions, so no existing manifest has to change:
        //   integration:respond        -> subscribes to user:prompt (+ election below)
        //   observe-host-effects  -> subscribes to the host-effect event family
        if provides.contains(&crate::capabilities::CAP_INTEGRATION_RESPOND.to_string()) {
            self.event_router.subscribe(USER_PROMPT_EVENT, &plugin_id);
            // Election survives as a POLICY over the general router: the first
            // respond-capable plugin becomes the default `user:prompt` target.
            let mut guard = self
                .default_responder_id
                .write()
                .expect("default_responder_id poisoned");
            if guard.is_none() {
                *guard = Some(plugin_id.clone());
                tracing::info!(plugin_id = %plugin_id, "registered as active agent");
            }
        }

        if provides.contains(&crate::observer::CAP_OBSERVE_HOST_EFFECTS.to_string()) {
            self.observer_channels
                .write()
                .expect("observer_channels poisoned")
                .insert(plugin_id.clone(), tx);
            tracing::info!(plugin_id = %plugin_id, "registered as host-effect observer");
        }

        self.plugin_runner_handles
            .write()
            .expect("plugin_runner_handles poisoned")
            .insert(plugin_id, joins);
    }

    /// Deliver an event to plugins via the neutral router. When `target` is
    /// `Some(plugin_id)` the event is delivered to exactly that plugin (the
    /// single-target case, e.g. `user:prompt` to the elected or named agent);
    /// when `None` it is broadcast to every plugin subscribed to `event`.
    /// Returns the number of plugins the event was sent to.
    ///
    /// This is the one path every event producer routes through, so a loaded
    /// plugin receives its own declared event by subscription rather than by the
    /// agent-shaped `plugin_channels.get(active_agent)` lookup.
    ///
    /// Every delivery emits a `router:deliver` telemetry event carrying the event
    /// name, how many plugins were wanted vs actually sent, and the ENQUEUE time —
    /// so a dropped event (zero subscribers, or a dead sender) shows up as
    /// `sent < wanted`. The real per-event EXECUTION cost + the head-of-line queue
    /// depth are a separate `plugin:on_event` event emitted from the runner thread
    /// where the work runs (`enqueue_us` alone would hide a serial drain stall).
    pub fn deliver(&self, event: &str, target: Option<&str>, payload: Option<String>) -> usize {
        deliver_via_router(
            &self.event_router,
            &self.plugin_channels,
            &self.telemetry,
            event,
            target,
            payload,
        )
    }

    /// Tear down ONE plugin: the honest inverse of register_for_events. Removes
    /// the plugin's sender from plugin_channels/observer_channels (dropping it
    /// closes the queue so every runner in the pool sees recv()→None and runs its
    /// own teardown+terminate), unsubscribes it from the event router, clears its
    /// cancel flag and any staged pool stores, deselects it if it was the active
    /// agent, and joins its runner thread(s). Returns true if the plugin was
    /// loaded. This is the per-plugin capability a real hot-reload needs (reload =
    /// unregister + load fresh bytes + register_for_events).
    pub async fn unregister(&self, plugin_id: &str) -> bool {
        // Drop the senders first so the runner drain loops observe a closed queue
        // and self-terminate (teardown + terminate) as they finish in-flight work.
        let had_channel = self
            .plugin_channels
            .write()
            .expect("plugin_channels poisoned")
            .remove(plugin_id)
            .is_some();
        self.observer_channels
            .write()
            .expect("observer_channels poisoned")
            .remove(plugin_id);

        // Neutral router + capability registry + agent policy + interrupt/staging state.
        self.event_router.unsubscribe_all(plugin_id);
        self.plugin_registry.unregister(plugin_id);
        self.cancel_flags
            .write()
            .expect("cancel_flags poisoned")
            .remove(plugin_id);
        self.pool_stores
            .lock()
            .expect("pool_stores poisoned")
            .remove(plugin_id);
        self.plugin_paths
            .write()
            .expect("plugin_paths poisoned")
            .remove(plugin_id);
        {
            let mut active = self
                .default_responder_id
                .write()
                .expect("default_responder_id poisoned");
            if active.as_deref() == Some(plugin_id) {
                *active = None;
            }
        }

        // Join the runner thread(s) — now that the queue is closed they exit
        // promptly. Off the async executor since JoinHandle::join blocks.
        let joins = self
            .plugin_runner_handles
            .write()
            .expect("plugin_runner_handles poisoned")
            .remove(plugin_id);
        if let Some(joins) = joins {
            let _ = tokio::task::spawn_blocking(move || {
                for join in joins {
                    if let Err(panic) = join.join() {
                        tracing::warn!("plugin runner thread panic during unregister: {panic:?}");
                    }
                }
            })
            .await;
        }

        if had_channel {
            tracing::info!(plugin_id, "plugin unregistered");
        }
        had_channel
    }

    /// Shut down all plugins and close storage.
    pub async fn shutdown(&self) -> Result<()> {
        tracing::info!("TractorNative shutting down");

        let senders = {
            let mut guard = self
                .plugin_channels
                .write()
                .expect("plugin_channels poisoned");
            guard.drain().map(|(_, tx)| tx).collect::<Vec<_>>()
        };

        for tx in &senders {
            let _ = tx.send(EventEnvelope::fire(SHUTDOWN_EVENT.to_string(), None));
        }
        drop(senders);

        let joins = {
            let mut guard = self
                .plugin_runner_handles
                .write()
                .expect("plugin_runner_handles poisoned");
            // Flatten every plugin's runner threads (1, or N for a pooled plugin).
            guard
                .drain()
                .flat_map(|(_, runners)| runners)
                .collect::<Vec<_>>()
        };

        for join in joins {
            if let Err(panic_payload) = join.join() {
                tracing::warn!(
                    "plugin runner thread panic during shutdown: {:?}",
                    panic_payload
                );
            }
        }

        self.storage.close()?;
        Ok(())
    }
}

#[cfg(test)]
mod event_router_tests {
    use super::EventRouter;

    #[test]
    fn subscribe_then_query_returns_the_plugin() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        assert_eq!(router.subscribers("vault:dispatch"), vec!["@demo/vault"]);
        assert!(router.has_subscribers("vault:dispatch"));
    }

    #[test]
    fn an_unsubscribed_event_has_no_subscribers() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        assert!(router.subscribers("quality:check").is_empty());
        assert!(!router.has_subscribers("quality:check"));
    }

    #[test]
    fn many_plugins_subscribe_to_the_same_event_deduped_and_ordered() {
        let router = EventRouter::default();
        router.subscribe("shared:event", "@b/plugin");
        router.subscribe("shared:event", "@a/plugin");
        router.subscribe("shared:event", "@b/plugin"); // idempotent
        // BTreeSet keeps them sorted and deduped.
        assert_eq!(
            router.subscribers("shared:event"),
            vec!["@a/plugin", "@b/plugin"]
        );
    }

    #[test]
    fn one_plugin_subscribes_to_many_events() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        router.subscribe("vault:reindex", "@demo/vault");
        assert_eq!(router.subscribers("vault:dispatch"), vec!["@demo/vault"]);
        assert_eq!(router.subscribers("vault:reindex"), vec!["@demo/vault"]);
    }

    #[test]
    fn unsubscribe_all_removes_the_plugin_from_every_event() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        router.subscribe("quality:check", "@demo/vault");
        router.subscribe("quality:check", "@demo/quality");
        router.unsubscribe_all("@demo/vault");
        assert!(router.subscribers("vault:dispatch").is_empty());
        // The other plugin's subscription survives.
        assert_eq!(router.subscribers("quality:check"), vec!["@demo/quality"]);
    }
}

#[cfg(test)]
mod pool_tests {
    use super::plugin_pool_size_from_env;

    // This module tests the env PARSER (plugin_pool_size_from_env) — the one place
    // REFARM_PLUGIN_POOL is read, and only ONCE at boot in production
    // (TractorNativeConfig::from_env). No production hot path or other test reads
    // this var, so mutating it here is not a cross-thread hazard for any other
    // test; the two cases here are serialized within one #[test] each. The
    // migrated read site (stage_pool_stores) now reads self.config.plugin_pool_size,
    // never env.
    fn with_pool_env<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        match value {
            Some(v) => std::env::set_var("REFARM_PLUGIN_POOL", v),
            None => std::env::remove_var("REFARM_PLUGIN_POOL"),
        }
        let out = f();
        std::env::remove_var("REFARM_PLUGIN_POOL");
        out
    }

    #[test]
    fn pool_size_defaults_to_one() {
        // Unset, empty, and invalid all keep the single-store runner (opt-in).
        assert_eq!(with_pool_env(None, plugin_pool_size_from_env), 1);
        assert_eq!(with_pool_env(Some(""), plugin_pool_size_from_env), 1);
        assert_eq!(with_pool_env(Some("nan"), plugin_pool_size_from_env), 1);
        assert_eq!(with_pool_env(Some("0"), plugin_pool_size_from_env), 1);
    }

    #[test]
    fn pool_size_parses_and_caps() {
        assert_eq!(with_pool_env(Some("1"), plugin_pool_size_from_env), 1);
        assert_eq!(with_pool_env(Some("4"), plugin_pool_size_from_env), 4);
        // Capped at 16 to stay under the 8GB host ceiling.
        assert_eq!(with_pool_env(Some("999"), plugin_pool_size_from_env), 16);
    }

    fn with_budget_env<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        match value {
            Some(v) => std::env::set_var("REFARM_ON_EVENT_TIMEOUT_MS", v),
            None => std::env::remove_var("REFARM_ON_EVENT_TIMEOUT_MS"),
        }
        let out = f();
        std::env::remove_var("REFARM_ON_EVENT_TIMEOUT_MS");
        out
    }

    #[test]
    fn event_budget_clamps_pathological_value_so_instant_add_cannot_overflow() {
        use super::{on_event_budget_ms_from_env, MAX_ON_EVENT_BUDGET_MS};
        // A huge budget must clamp, not pass through — otherwise
        // Instant::now() + Duration::from_millis(budget) panics (overflow) on the
        // hot path, inside the wall_deadline lock, poisoning the guard.
        let clamped = with_budget_env(Some(&u64::MAX.to_string()), on_event_budget_ms_from_env);
        assert_eq!(clamped, MAX_ON_EVENT_BUDGET_MS);
        // And the clamped value must not overflow the real Instant add.
        assert!(std::time::Instant::now()
            .checked_add(std::time::Duration::from_millis(clamped))
            .is_some());
        // Normal + default still resolve untouched.
        assert_eq!(with_budget_env(Some("50"), on_event_budget_ms_from_env), 50);
        assert_eq!(with_budget_env(None, on_event_budget_ms_from_env), 2_000);
    }
}

#[cfg(test)]
mod deliver_observability_tests {
    use super::{TractorNative, TractorNativeConfig};
    use crate::SecurityMode;

    fn memory_config() -> TractorNativeConfig {
        TractorNativeConfig {
            namespace: ":memory:".to_string(),
            port: 0,
            security_mode: SecurityMode::None,
            ..TractorNativeConfig::default()
        }
    }

    /// deliver() must NEVER be a blind spot: an event with no reachable recipient
    /// emits a `router:deliver` telemetry event whose `undeliverable` is the
    /// degradation signal. This is the observability that keeps us from flying
    /// blind when we stretch the rope (accept new events) without the scarecrow.
    #[tokio::test]
    async fn deliver_emits_telemetry_with_the_undeliverable_signal() {
        let tractor = TractorNative::boot(memory_config())
            .await
            .expect("boot must succeed");
        let mut telemetry = tractor.telemetry.subscribe();

        // Target a plugin that is not registered: nothing to send to, so the
        // event is undeliverable — exactly the case we must be able to SEE.
        let sent = tractor.deliver("vault:dispatch", Some("@ghost/plugin"), None);
        assert_eq!(sent, 0, "an unregistered target receives nothing");

        // The telemetry event fired and carries the degradation signal.
        let event = telemetry
            .try_recv()
            .expect("a router:deliver telemetry event must be emitted");
        assert_eq!(event.event, "router:deliver");
        // enqueue_us is the enqueue time (the real drain is in plugin:on_event).
        let payload = event.payload.expect("payload present");
        assert_eq!(payload["event"], "vault:dispatch");
        assert_eq!(payload["wanted"], 1);
        assert_eq!(payload["sent"], 0);
        assert_eq!(payload["undeliverable"], 1);
        assert!(
            payload["enqueue_us"].as_u64().is_some(),
            "enqueue_us must be recorded (the real drain cost is in plugin:on_event)"
        );

        tractor.shutdown().await.expect("shutdown must succeed");
    }

    /// A broadcast with zero subscribers is also visible (wanted 0, sent 0) — a
    /// silently-dropped event can never masquerade as success.
    #[tokio::test]
    async fn deliver_with_no_subscribers_is_still_observable() {
        let tractor = TractorNative::boot(memory_config())
            .await
            .expect("boot must succeed");
        let mut telemetry = tractor.telemetry.subscribe();

        let sent = tractor.deliver("nobody:listens", None, None);
        assert_eq!(sent, 0);

        let event = telemetry.try_recv().expect("telemetry emitted");
        let payload = event.payload.expect("payload present");
        assert_eq!(payload["wanted"], 0);
        assert_eq!(payload["sent"], 0);

        tractor.shutdown().await.expect("shutdown must succeed");
    }
}

#[cfg(test)]
mod respond_error_result_tests {
    use super::{write_terminal_error_result, NativeStorage, NativeSync};
    use crate::sidecar::{find_terminal_result, TerminalResultSpec};

    // #4: a respond whose guest errors must surface as a terminal ERROR result the
    // watcher finalises `failed` on — not a 45s false `timed-out`. Prove the
    // bridge: write_terminal_error_result projects a node that the generalized
    // watcher's find_terminal_result matches via the agent default spec, carrying
    // is_error = true and the real error text.
    #[test]
    fn runner_projects_terminal_error_result_that_the_watcher_finds() {
        let ns = format!("/tmp/tractor-respond-err-{}.db", std::process::id());
        let _ = std::fs::remove_file(&ns);
        let storage = NativeStorage::open(&ns).unwrap();
        let sync = NativeSync::new(storage, &ns).unwrap();

        let prompt_ref = "urn:refarm:prompt-abc";
        write_terminal_error_result(&sync, "@refarm/agent", prompt_ref, "guest blew up: boom");

        // The generalized watcher (agent default spec) finds it as a terminal error.
        let found = find_terminal_result(&ns, &TerminalResultSpec::agent_response(prompt_ref))
            .expect("watcher must find the projected terminal error result");
        assert!(found.is_error, "the projected result must be a terminal error");
        assert_eq!(found.content, "guest blew up: boom");

        let _ = std::fs::remove_file(&ns);
    }
}
