// PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//
// Two bindgen worlds:
//   - `refarm-plugin-host`  → regular integration plugins (tractor-bridge, host-fs/shell)
//   - `host-effects-host`   → the host-effects.wasm composition component (host-spawn)
//
// Two loader paths (ADR-061):
//   - ComponentLoader  → wasmtime::component::Component, WIT bindgen!, P2+
//   - ModuleLoader     → wasmtime::Module, WASI preview1 ABI, P1 plain modules

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock, Weak};

use anyhow::Result;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Module, Store};
use wasmtime_wasi::{DirPerms, FilePerms, ResourceTable, WasiCtx, WasiCtxBuilder, WasiView};

use crate::host::instance::PluginInstanceHandle;
use crate::host::wasi_bridge::TractorNativeBindings;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::trust::{SecurityMode, TrustManager};

// ── WIT Bindings: regular integration plugins ─────────────────────────────────
//
// Reads `../refarm-plugin-wit/wit/refarm-plugin-host.wit`.
// Generates RefarmPluginHost + host traits for tractor-bridge, host-fs, host-shell.

wasmtime::component::bindgen!({
    world: "refarm-plugin-host",
    path: "../refarm-plugin-wit/wit",
    async: true,
});

// host_effects_bindings is defined in host_effects_bindings.rs — kept separate
// so the two bindgen! expansions live in different Rust modules (both generate
// a `refarm` root and would collide if in the same file/scope).
use crate::host::host_effects_bindings as atb;

// ── EpochGuard ────────────────────────────────────────────────────────────────
//
// Per-store state read by the epoch_deadline_callback to decide, when the shared
// epoch clock reaches this store's deadline, whether to interrupt the guest.
// This is the escape from the global-epoch footgun proven in the epoch-semantics
// suite: cranking the global epoch wakes EVERY store's callback, so each store
// must self-judge. A store traps only when its OWN cancel flag is set or its OWN
// wall-clock deadline has genuinely elapsed; otherwise it re-arms (a neighbour
// woken early by someone else's crank survives).
#[derive(Clone)]
pub(crate) struct EpochGuard {
    /// Set by a cancel to force-interrupt this store's guest on the next tick.
    pub(crate) cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Wall-clock deadline for the in-flight guest call (armed before on_event).
    /// `None` outside a bounded call. A genuinely-elapsed deadline traps; a
    /// callback firing before it re-arms.
    pub(crate) wall_deadline: std::sync::Arc<std::sync::Mutex<Option<std::time::Instant>>>,
}

impl EpochGuard {
    pub(crate) fn new() -> Self {
        Self {
            cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            wall_deadline: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

impl Default for EpochGuard {
    fn default() -> Self {
        Self::new()
    }
}

/// Store data that carries an EpochGuard. Implemented by every store type, so a
/// single generic factory (`new_armed_store`) can create+arm ANY store the same
/// way — making an un-armed store on an epoch-enabled engine unrepresentable.
pub(crate) trait HasEpochGuard {
    fn epoch_guard(&self) -> &EpochGuard;
}

// ── TractorStore ──────────────────────────────────────────────────────────────

pub(crate) struct TractorStore {
    pub wasi: WasiCtx,
    pub http: wasmtime_wasi_http::WasiHttpCtx,
    pub bindings: TractorNativeBindings,
    pub table: ResourceTable,
    pub epoch_guard: EpochGuard,
}

impl WasiView for TractorStore {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

impl HasEpochGuard for TractorStore {
    fn epoch_guard(&self) -> &EpochGuard {
        &self.epoch_guard
    }
}

impl wasmtime_wasi_http::WasiHttpView for TractorStore {
    fn ctx(&mut self) -> &mut wasmtime_wasi_http::WasiHttpCtx {
        &mut self.http
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

// ── P1 module store ───────────────────────────────────────────────────────────
//
// Plain WASM modules (WASI preview1 ABI) use a simpler store — just WasiP1Ctx.
// WasiP1Ctx bundles both the WASI context and the resource table internally,
// so no separate ResourceTable field is needed.

pub(crate) struct P1Store {
    pub wasi: wasmtime_wasi::preview1::WasiP1Ctx,
    pub epoch_guard: EpochGuard,
}

impl HasEpochGuard for P1Store {
    fn epoch_guard(&self) -> &EpochGuard {
        &self.epoch_guard
    }
}

// ── HostEffectsHandle ──────────────────────────────────────────────────────────
//
// A loaded host-effects.wasm instance. Holds the typed caller (HostEffectsHost)
// and the store. Future Fase 3 composition will extract Func refs from here
// to wire into agent's linker — see HANDOFF.md Tarefa 2B / 2C.

pub struct HostEffectsHandle {
    pub id: String,
    /// Typed caller for host-fs + host-shell exports on the component.
    #[allow(dead_code)]
    pub(crate) component: atb::HostEffectsHost,
    /// Isolated store for host-effects.wasm (each plugin owns its store).
    #[allow(dead_code)]
    pub(crate) store: Store<TractorStore>,
}

impl HostEffectsHandle {
    pub(crate) fn new(
        id: String,
        component: atb::HostEffectsHost,
        store: Store<TractorStore>,
    ) -> Self {
        Self {
            id,
            component,
            store,
        }
    }
}

impl std::fmt::Debug for HostEffectsHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostEffectsHandle")
            .field("id", &self.id)
            .finish()
    }
}

// ── PluginHost ────────────────────────────────────────────────────────────────

/// How a grant set is sourced at load. `PluginHost::new` cannot resolve the config
/// node (it has no `sync` — the replication handle only arrives at `load()`), so boot
/// records the INTENT and load performs the resolution.
///
/// - `ResolveFromConfig` → resolve per-load from fs ∩ node (deny-dominates — B).
/// - `Injected(v)` → an explicit test/alt-host override; `v` (Some OR None) wins verbatim,
///   no fs/sync read, keeping the deterministic test path.
pub(crate) enum GrantSource<T> {
    ResolveFromConfig,
    Injected(T),
}

/// Orchestrates WASM plugin loading and lifecycle via wasmtime.
pub struct PluginHost {
    trust: TrustManager,
    telemetry: TelemetryBus,
    engine: Arc<Engine>,
    /// Linker for regular integration plugins (tractor-bridge, host-fs, host-shell host primitives).
    /// Includes wasi:http — used for a plugin that was GRANTED network:outbound.
    linker: Arc<Linker<TractorStore>>,
    /// Same as `linker` but WITHOUT wasi:http. A plugin that did not declare
    /// network:outbound (under Strict) is instantiated against this, so importing
    /// wasi:http fails to link — the first real per-plugin WASI enforcement.
    linker_no_http: Arc<Linker<TractorStore>>,
    /// Linker for host-effects.wasm (WASI + host-spawn; no tractor-bridge).
    host_effects_linker: Arc<Linker<TractorStore>>,
    /// Sync engine for P1 plain modules — no async support, no component model.
    /// P1 modules use blocking WASI calls; they run on their own OS thread via
    /// `register_for_events`, so blocking the async executor is never a concern.
    module_engine: Arc<Engine>,
    /// Linker for P1 plain modules (wasmtime::Module + WASI preview1 ABI, ADR-061).
    module_linker: Arc<wasmtime::Linker<P1Store>>,
    /// Compiled-component cache, keyed by the wasm CONTENT HASH (not path).
    /// Compiling a component with Cranelift dominates load() (~200ms/instance
    /// measured), so we compile once per distinct byte content and clone the
    /// cached Component (an Arc-backed handle) for every subsequent load —
    /// turning the N-store pool's boot from N compiles into one. Keying by hash
    /// (rather than path) means a rebuilt plugin at the same path misses the
    /// cache and recompiles automatically (no stale code), and identical bytes at
    /// different paths dedupe to one compile.
    component_cache: Arc<RwLock<HashMap<String, Component>>>,
    /// Wall-clock budget (ms) for a single plugin `on_event` call, resolved from
    /// config at construction (env override `REFARM_ON_EVENT_TIMEOUT_MS` is read
    /// ONCE at boot). Stamped onto every `PluginInstanceHandle` at load so the
    /// per-event hot path reads a field, never `std::env::var`.
    on_event_budget_ms: u64,
    /// Effect-dispatch policy (shell allowlist + fs root) resolved from env ONCE
    /// at construction and cloned into every `TractorNativeBindings` at load, so
    /// the per-call effect path reads `&self`, never `std::env::var`.
    effect_policy: crate::host::host_effects_bridge::HostEffectPolicy,
    /// The operator's sovereign trusted-plugins allowlist. Seeds the Strict LOAD gate:
    /// a plugin whose id is listed (or `*`) is trusted to load without a per-hash grant.
    /// `ResolveFromConfig` (the `new` default) resolves it PER-LOAD from fs ∩ node
    /// (deny-dominates — B), so a device that received its config purely over CRDT still
    /// enforces the replicated allowlist. `Injected(v)` (a test/alt-host override) wins
    /// verbatim. Resolved value semantics: None = not configured → permissive
    /// (backward-compatible); empty = deny-all; `*` = trust every plugin.
    trusted_plugins_source: GrantSource<Option<std::collections::HashSet<String>>>,
    /// The operator-APPROVED capability set per plugin id (written by `plugin approve`).
    /// At load the declared permissions are intersected with a plugin's approved set, so
    /// approving fewer capabilities actually restricts. `ResolveFromConfig` resolves it
    /// PER-LOAD from fs ∩ node (deny-dominates); `Injected(v)` wins verbatim. Resolved
    /// value: None = no approvals → declared stands; a plugin absent from the map = no
    /// approval → declared unchanged (additive scoping, not a second deny gate).
    approved_permissions_source: GrantSource<
        Option<std::collections::HashMap<String, std::collections::HashSet<String>>>,
    >,
    /// The expected model route (provider + base-url + path) guardrail, resolved
    /// from the routing env vars ONCE at construction and cloned into every
    /// `TractorNativeBindings` at load. Only ROUTING config — API-key secrets stay
    /// in env, read per-request at send time.
    model_route: crate::host::wasi_bridge::ModelRoute,
    /// The OPTIONAL fallback route, resolved from MODEL_FALLBACK_PROVIDER once at
    /// construction (None when unset) and cloned into every `TractorNativeBindings`
    /// at load. When set, the model-POST guardrail accepts the primary OR this
    /// route — the host half of the guest's MODEL_FALLBACK_PROVIDER retry.
    fallback_route: Option<crate::host::wasi_bridge::ModelRoute>,
}

/// Forward only MODEL_* vars into plugin WASI env.
///
/// Security: avoids leaking unrelated host environment variables (credentials,
/// tokens, etc.) into the plugin sandbox.
fn forwarded_model_env_vars() -> Vec<(String, String)> {
    forwarded_model_env_vars_from_iter(std::env::vars())
}

fn forwarded_model_env_vars_from_iter<I>(vars: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    // Boundary-local (not shared): transport/runtime quotas and dedupe mechanics.
    // Semantic allow/deny policy for `MODEL_*` keys/values is delegated to
    // `crate::host::sensitive_aliases`.
    const MAX_FORWARDED_MODEL_ENV_VARS: usize = 128;
    const MAX_FORWARDED_MODEL_ENV_SCAN: usize = 512;
    const MAX_FORWARDED_MODEL_ENV_TOTAL_BYTES: usize = 64 * 1024;

    let mut out = Vec::new();
    let mut total_bytes = 0usize;
    let mut seen_keys = std::collections::HashSet::new();

    for (k, v) in vars.into_iter().take(MAX_FORWARDED_MODEL_ENV_SCAN) {
        if out.len() >= MAX_FORWARDED_MODEL_ENV_VARS {
            break;
        }
        if !is_forwardable_model_env_key(&k) || !is_forwardable_model_env_value(&v) {
            continue;
        }
        if seen_keys.contains(&k) {
            continue;
        }
        let next_total = total_bytes.saturating_add(k.len() + v.len());
        if next_total > MAX_FORWARDED_MODEL_ENV_TOTAL_BYTES {
            continue;
        }
        seen_keys.insert(k.clone());
        total_bytes = next_total;
        out.push((k, v));
    }

    out
}

fn is_forwardable_model_env_key(key: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_model_env_key(key)
}
