// PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//
// Two bindgen worlds:
//   - `host-plugin`         → regular integration plugins (tractor-bridge, host-fs/shell)
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
// Reads the `host-plugin` world from `../plugin-wit/wit` (worlds.wit).
// Generates HostPlugin + host traits for tractor-bridge, host-fs, host-shell.

wasmtime::component::bindgen!({
    world: "host-plugin",
    path: "../plugin-wit/wit",
    async: true,
});

// host_effects_bindings is defined in host_effects_bindings.rs — kept separate
// so the two bindgen! expansions live in different Rust modules (they would
// generate colliding roots if placed in the same file/scope).
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
    /// Which plugins THIS NODE has declared it is developing (Task 6, `.refarm/config.json`
    /// `pluginDevelopment`, keyed by the runtime id). Consulted ONLY to waive an ABSENT
    /// integrity claim (never a wrong one) at the load-time integrity gate. `ResolveFromConfig`
    /// resolves it PER-LOAD from the sovereign fs config; `Injected(v)` wins verbatim — for a
    /// test/alt-host override, and for tests that must exercise plain-module loading without a
    /// signed artifact and without a config file in the process cwd. Resolved value semantics
    /// (UNLIKE the two grants above): `None` = nothing declared → CLOSED (no plugin waived);
    /// `Some(set)` = the runtime ids waived (`*` = every plugin, matching `trusted_to_load`'s
    /// wildcard). There is no "not configured → permissive" reading here — an absent
    /// declaration must never be read as consent.
    under_development_source: GrantSource<Option<std::collections::HashSet<String>>>,
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
    /// The shared cross-plugin access (registry + router handles), cloned into every
    /// `TractorNativeBindings` at load so a plugin's host-call can list/invoke OTHER
    /// loaded plugins' verbs (agent leg #6) and resolve a named API (`get_plugin_api`).
    /// `None` until the runtime wires it via `with_cross_plugin` (test hosts / the
    /// bare `new` keep the pre-registry behavior). Set once at boot; Arc-shared.
    cross_plugin: Option<crate::host::wasi_bridge::CrossPluginAccess>,
    /// The SHARED registry of declared connections — ONE per host process,
    /// constructed once in `new` beside `engine`/`linker` and cloned (the `Arc`,
    /// not a fresh instance) into every `TractorNativeBindings` at load. This is
    /// what makes `ensure("serpro-vpn")` from two different plugins observe the
    /// SAME live connection and ONE login, instead of one login per plugin.
    connection_registry: Arc<crate::host::host_effects_bridge::ConnectionRegistry>,
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
        // Key-aware: a text-content key (MODEL_SKILLS / MODEL_SKILL_BODIES) carries prose
        // the model reads, so it gets a text policy (whitespace/newlines/larger cap);
        // every other MODEL_* key gets the credential-shaped default. The secret-key
        // blocklist (*TOKEN*/*SECRET*/…) still applies to both via the key check inside.
        if !is_forwardable_model_env_pair(&k, &v) {
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

// Thin local wrappers over the shared env-forward policy. `is_forwardable_model_env_pair`
// is the one production forwarding uses (key-aware: text-content keys get the text rule);
// the `_key`/`_value` wrappers remain the per-axis policy the env_policy_core tests pin.
fn is_forwardable_model_env_pair(key: &str, value: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_model_env_pair(key, value)
}

#[cfg(test)]
fn is_forwardable_model_env_key(key: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_model_env_key(key)
}

#[cfg(test)]
fn is_forwardable_model_env_value(value: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_model_env_value(value)
}

#[cfg(test)]
mod core_env_forward_tests {
    use super::*;

    // ── forwarded_model_env_vars_from_iter ─────────────────────────────────────
    //
    // Pure over an explicit (String, String) iterator — never touches real env.

    fn owned(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn forwards_only_model_keys_and_drops_non_model_and_bad_values() {
        let input = owned(&[
            ("MODEL_PROVIDER", "openai"),
            ("MODEL_PROVIDER_BASE_URL", "https://api.example.com"),
            ("HOME", "/root"),                 // not MODEL_* → dropped
            ("PATH", "/usr/bin"),              // not MODEL_* → dropped
            ("MODEL_PROVIDER_ID", "has space"), // whitespace value → dropped
        ]);
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(
            out,
            vec![
                ("MODEL_PROVIDER".to_string(), "openai".to_string()),
                (
                    "MODEL_PROVIDER_BASE_URL".to_string(),
                    "https://api.example.com".to_string()
                ),
            ]
        );
    }

    #[test]
    fn blocks_token_and_secret_shaped_model_keys() {
        let input = owned(&[
            ("MODEL_SESSION_TOKEN", "abc123"), // *_TOKEN segment → blocked
            ("MODEL_API_SECRET", "shh"),       // *_SECRET segment → blocked
            ("MODEL_API_KEY", "sk-xxx"),       // *_KEY suffix → blocked
            ("MODEL_PROVIDER", "openai"),      // clean → forwarded
        ]);
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(
            out,
            vec![("MODEL_PROVIDER".to_string(), "openai".to_string())]
        );
    }

    #[test]
    fn dedupes_repeated_keys_keeping_first_value() {
        let input = owned(&[
            ("MODEL_PROVIDER", "openai"),
            ("MODEL_PROVIDER", "anthropic"), // duplicate key → dropped
            ("MODEL_ID", "gpt-4"),
        ]);
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(
            out,
            vec![
                ("MODEL_PROVIDER".to_string(), "openai".to_string()),
                ("MODEL_ID".to_string(), "gpt-4".to_string()),
            ]
        );
    }

    #[test]
    fn forwards_text_content_key_with_whitespace_value() {
        // MODEL_SKILLS is a text-content key: its value carries newlines/whitespace
        // that the credential-shaped default value rule would reject.
        let input = owned(&[("MODEL_SKILLS", "skill-a\nskill-b description")]);
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(
            out,
            vec![(
                "MODEL_SKILLS".to_string(),
                "skill-a\nskill-b description".to_string()
            )]
        );
    }

    #[test]
    fn count_cap_limits_to_128_forwarded_vars() {
        // 130 distinct, clean MODEL_* vars — small enough to never hit the byte cap,
        // few enough to never hit the scan cap — so the 128 count cap is what bites.
        let input: Vec<(String, String)> = (0..130)
            .map(|i| (format!("MODEL_N{i}"), "v".to_string()))
            .collect();
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(out.len(), 128);
        // The first 128 (in iteration order) are the ones kept.
        assert_eq!(out[0].0, "MODEL_N0");
        assert_eq!(out[127].0, "MODEL_N127");
        assert!(!out.iter().any(|(k, _)| k == "MODEL_N128"));
    }

    #[test]
    fn scan_cap_ignores_entries_beyond_512() {
        // 512 non-forwardable junk entries fill the entire scan window; a valid
        // MODEL_* var placed at index 512 is never reached.
        let mut beyond: Vec<(String, String)> = (0..512)
            .map(|i| (format!("JUNK_{i}"), "x".to_string()))
            .collect();
        beyond.push(("MODEL_PROVIDER".to_string(), "openai".to_string()));
        let out = forwarded_model_env_vars_from_iter(beyond);
        assert!(out.is_empty(), "var at index 512 is beyond the scan cap");

        // Control: the SAME valid var at index 511 is inside the window → forwarded.
        let mut within: Vec<(String, String)> = (0..511)
            .map(|i| (format!("JUNK_{i}"), "x".to_string()))
            .collect();
        within.push(("MODEL_PROVIDER".to_string(), "openai".to_string()));
        let out = forwarded_model_env_vars_from_iter(within);
        assert_eq!(
            out,
            vec![("MODEL_PROVIDER".to_string(), "openai".to_string())]
        );
    }

    #[test]
    fn total_bytes_cap_stops_forwarding_past_64_kib() {
        // Each var is key(8) + value(4000) = 4008 bytes. 16 vars = 64128 ≤ 65536;
        // the 17th would push the running total to 68136 > 65536, so it (and the
        // 18th) are skipped. The count cap (128) never bites here — the byte cap does.
        let big = "a".repeat(4000);
        let letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
        let input: Vec<(String, String)> = letters
            .iter()
            .map(|l| (format!("MODEL_K{l}"), big.clone()))
            .collect();
        let out = forwarded_model_env_vars_from_iter(input);
        assert_eq!(out.len(), 16);
        assert_eq!(out[0].0, "MODEL_KA");
        assert_eq!(out[15].0, "MODEL_KP");
        assert!(!out.iter().any(|(k, _)| k == "MODEL_KQ"));
    }

    #[test]
    fn empty_iterator_forwards_nothing() {
        let out = forwarded_model_env_vars_from_iter(Vec::<(String, String)>::new());
        assert!(out.is_empty());
    }

    // ── per-axis policy wrappers ───────────────────────────────────────────────

    #[test]
    fn per_axis_key_and_value_wrappers_agree_with_policy() {
        assert!(is_forwardable_model_env_key("MODEL_PROVIDER"));
        assert!(!is_forwardable_model_env_key("MODEL_API_KEY"));
        assert!(!is_forwardable_model_env_key("HOME"));

        assert!(is_forwardable_model_env_value("openai"));
        assert!(!is_forwardable_model_env_value("has space"));
        assert!(!is_forwardable_model_env_value(""));
    }

    #[test]
    fn is_forwardable_pair_matches_key_and_value_axes() {
        assert!(is_forwardable_model_env_pair("MODEL_PROVIDER", "openai"));
        assert!(!is_forwardable_model_env_pair("MODEL_PROVIDER", "has space"));
        assert!(!is_forwardable_model_env_pair("MODEL_API_KEY", "sk-xxx"));
        // Text-content key admits a whitespace value the default rule rejects.
        assert!(is_forwardable_model_env_pair("MODEL_SKILLS", "a\nb"));
    }

    // ── EpochGuard ─────────────────────────────────────────────────────────────

    #[test]
    fn epoch_guard_new_starts_uncancelled_with_no_deadline() {
        let g = EpochGuard::new();
        assert!(!g.cancel.load(std::sync::atomic::Ordering::SeqCst));
        assert!(g.wall_deadline.lock().unwrap().is_none());
    }

    #[test]
    fn epoch_guard_default_matches_new() {
        let g = EpochGuard::default();
        assert!(!g.cancel.load(std::sync::atomic::Ordering::SeqCst));
        assert!(g.wall_deadline.lock().unwrap().is_none());
    }
}
