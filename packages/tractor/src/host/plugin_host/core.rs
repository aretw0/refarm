// PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//
// Two bindgen worlds:
//   - `refarm-plugin-host`  → regular integration plugins (tractor-bridge, agent-fs/shell)
//   - `agent-tools-host`    → the agent-tools.wasm composition component (host-spawn)
//
// Two loader paths (ADR-061):
//   - ComponentLoader  → wasmtime::component::Component, WIT bindgen!, P2+
//   - ModuleLoader     → wasmtime::Module, WASI preview1 ABI, P1 plain modules

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Module, Store};
use wasmtime_wasi::{ResourceTable, WasiCtx, WasiCtxBuilder, WasiView};

use crate::host::instance::PluginInstanceHandle;
use crate::host::wasi_bridge::TractorNativeBindings;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::trust::{SecurityMode, TrustManager};

// ── WIT Bindings: regular integration plugins ─────────────────────────────────
//
// Reads `../refarm-plugin-wit/wit/refarm-plugin-host.wit`.
// Generates RefarmPluginHost + host traits for tractor-bridge, agent-fs, agent-shell.

wasmtime::component::bindgen!({
    world: "refarm-plugin-host",
    path: "../refarm-plugin-wit/wit",
    async: true,
});

// agent_tools_bindings is defined in agent_tools_bindings.rs — kept separate
// so the two bindgen! expansions live in different Rust modules (both generate
// a `refarm` root and would collide if in the same file/scope).
use crate::host::agent_tools_bindings as atb;

// ── TractorStore ──────────────────────────────────────────────────────────────

pub(crate) struct TractorStore {
    pub wasi: WasiCtx,
    pub http: wasmtime_wasi_http::WasiHttpCtx,
    pub bindings: TractorNativeBindings,
    pub table: ResourceTable,
}

impl WasiView for TractorStore {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
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
}

// ── AgentToolsHandle ──────────────────────────────────────────────────────────
//
// A loaded agent-tools.wasm instance. Holds the typed caller (AgentToolsHost)
// and the store. Future Fase 3 composition will extract Func refs from here
// to wire into pi-agent's linker — see HANDOFF.md Tarefa 2B / 2C.

pub struct AgentToolsHandle {
    pub id: String,
    /// Typed caller for agent-fs + agent-shell exports on the component.
    #[allow(dead_code)]
    pub(crate) component: atb::AgentToolsHost,
    /// Isolated store for agent-tools.wasm (each plugin owns its store).
    #[allow(dead_code)]
    pub(crate) store: Store<TractorStore>,
}

impl AgentToolsHandle {
    pub(crate) fn new(
        id: String,
        component: atb::AgentToolsHost,
        store: Store<TractorStore>,
    ) -> Self {
        Self {
            id,
            component,
            store,
        }
    }
}

impl std::fmt::Debug for AgentToolsHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentToolsHandle")
            .field("id", &self.id)
            .finish()
    }
}

// ── PluginHost ────────────────────────────────────────────────────────────────

/// Orchestrates WASM plugin loading and lifecycle via wasmtime.
pub struct PluginHost {
    trust: TrustManager,
    telemetry: TelemetryBus,
    engine: Arc<Engine>,
    /// Linker for regular integration plugins (tractor-bridge, agent-fs, agent-shell host primitives).
    linker: Arc<Linker<TractorStore>>,
    /// Linker for agent-tools.wasm (WASI + host-spawn; no tractor-bridge).
    agent_tools_linker: Arc<Linker<TractorStore>>,
    /// Sync engine for P1 plain modules — no async support, no component model.
    /// P1 modules use blocking WASI calls; they run on their own OS thread via
    /// `register_for_events`, so blocking the async executor is never a concern.
    module_engine: Arc<Engine>,
    /// Linker for P1 plain modules (wasmtime::Module + WASI preview1 ABI, ADR-061).
    module_linker: Arc<wasmtime::Linker<P1Store>>,
}

/// Forward only LLM_* vars into plugin WASI env.
///
/// Security: avoids leaking unrelated host environment variables (credentials,
/// tokens, etc.) into the plugin sandbox.
fn forwarded_llm_env_vars() -> Vec<(String, String)> {
    forwarded_llm_env_vars_from_iter(std::env::vars())
}

fn forwarded_llm_env_vars_from_iter<I>(vars: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    // Boundary-local (not shared): transport/runtime quotas and dedupe mechanics.
    // Semantic allow/deny policy for `LLM_*` keys/values is delegated to
    // `crate::host::sensitive_aliases`.
    const MAX_FORWARDED_LLM_ENV_VARS: usize = 128;
    const MAX_FORWARDED_LLM_ENV_SCAN: usize = 512;
    const MAX_FORWARDED_LLM_ENV_TOTAL_BYTES: usize = 64 * 1024;

    let mut out = Vec::new();
    let mut total_bytes = 0usize;
    let mut seen_keys = std::collections::HashSet::new();

    for (k, v) in vars.into_iter().take(MAX_FORWARDED_LLM_ENV_SCAN) {
        if out.len() >= MAX_FORWARDED_LLM_ENV_VARS {
            break;
        }
        if !is_forwardable_llm_env_key(&k) || !is_forwardable_llm_env_value(&v) {
            continue;
        }
        if seen_keys.contains(&k) {
            continue;
        }
        let next_total = total_bytes.saturating_add(k.len() + v.len());
        if next_total > MAX_FORWARDED_LLM_ENV_TOTAL_BYTES {
            continue;
        }
        seen_keys.insert(k.clone());
        total_bytes = next_total;
        out.push((k, v));
    }

    out
}

fn is_forwardable_llm_env_key(key: &str) -> bool {
    crate::host::sensitive_aliases::is_forwardable_llm_env_key(key)
}
