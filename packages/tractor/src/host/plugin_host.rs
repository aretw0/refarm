//! PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//!
//! Phase 4: wasmtime Component Model, WIT bindings via `bindgen!` macro.
//!
//! Two bindgen worlds:
//!   - `refarm-plugin-host`  → regular integration plugins (tractor-bridge, agent-fs/shell)
//!   - `agent-tools-host`    → the agent-tools.wasm composition component (host-spawn)

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{ResourceTable, WasiCtx, WasiCtxBuilder, WasiView};

use crate::host::instance::PluginInstanceHandle;
use crate::host::wasi_bridge::TractorNativeBindings;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::trust::{SecurityMode, TrustManager};

// ── WIT Bindings: regular integration plugins ─────────────────────────────────
//
// Reads `wit/host/refarm-plugin-host.wit`.
// Generates RefarmPluginHost + host traits for tractor-bridge, agent-fs, agent-shell.

wasmtime::component::bindgen!({
    world: "refarm-plugin-host",
    path: "wit/host",
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
    fn ctx(&mut self) -> &mut WasiCtx { &mut self.wasi }
    fn table(&mut self) -> &mut ResourceTable { &mut self.table }
}

impl wasmtime_wasi_http::WasiHttpView for TractorStore {
    fn ctx(&mut self) -> &mut wasmtime_wasi_http::WasiHttpCtx { &mut self.http }
    fn table(&mut self) -> &mut ResourceTable { &mut self.table }
}

// ── AgentToolsHandle ──────────────────────────────────────────────────────────
//
// A loaded agent-tools.wasm instance. Holds the typed caller (AgentToolsHost)
// and the store. Future Fase 3 composition will extract Func refs from here
// to wire into pi-agent's linker — see HANDOFF.md Tarefa 2B / 2C.

pub struct AgentToolsHandle {
    pub id: String,
    /// Typed caller for agent-fs + agent-shell exports on the component.
    pub(crate) component: atb::AgentToolsHost,
    /// Isolated store for agent-tools.wasm (each plugin owns its store).
    pub(crate) store: Store<TractorStore>,
}

impl AgentToolsHandle {
    pub(crate) fn new(
        id: String,
        component: atb::AgentToolsHost,
        store: Store<TractorStore>,
    ) -> Self {
        Self { id, component, store }
    }
}

impl std::fmt::Debug for AgentToolsHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentToolsHandle").field("id", &self.id).finish()
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
}

impl PluginHost {
    pub fn new(trust: TrustManager, telemetry: TelemetryBus) -> Result<Self> {
        let mut config = Config::new();
        config.async_support(true);
        config.wasm_component_model(true);
        let engine = Arc::new(Engine::new(&config)?);

        // ── Regular plugin linker ──────────────────────────────────────────
        let mut linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
        RefarmPluginHost::add_to_linker(&mut linker, |s| &mut s.bindings)?;

        // ── agent-tools.wasm linker ────────────────────────────────────────
        // Does NOT include tractor-bridge (agent-tools is not an integration plugin).
        // Includes WASI (for std::fs → wasi:filesystem) + host-spawn (for OS fork/exec).
        let mut agent_tools_linker: Linker<TractorStore> = Linker::new(&engine);
        wasmtime_wasi::add_to_linker_async(&mut agent_tools_linker)?;
        atb::AgentToolsHost::add_to_linker(
            &mut agent_tools_linker,
            |s| &mut s.bindings,
        )?;

        Ok(Self {
            trust,
            telemetry,
            engine,
            linker: Arc::new(linker),
            agent_tools_linker: Arc::new(agent_tools_linker),
        })
    }

    /// Load a regular integration plugin (`.wasm` Component).
    ///
    /// Uses the regular linker: tractor-bridge + agent-fs/shell host primitives.
    /// Fase 3 TODO: if `agent_tools` is loaded, compose agent-fs/shell from it
    /// instead of the host primitive — see HANDOFF.md Tarefa 2B.
    pub async fn load(&self, path: &Path, sync: &NativeSync) -> Result<PluginInstanceHandle> {
        let plugin_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        tracing::info!(plugin_id = %plugin_id, path = %path.display(), "Loading plugin");
        anyhow::ensure!(path.exists(), "Plugin file not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));
        tracing::debug!(plugin_id = %plugin_id, wasm_hash = %wasm_hash, "Plugin hash computed");

        if self.trust.security_mode() == &SecurityMode::Strict
            && !self.trust.has_valid_grant(&plugin_id, Some(&wasm_hash))
        {
            anyhow::bail!(
                "SecurityMode::Strict: no valid trust grant for plugin '{}' (hash: {})",
                plugin_id,
                wasm_hash
            );
        }

        let wasi = WasiCtxBuilder::new().inherit_stderr().build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        let bindings = TractorNativeBindings::new(&plugin_id, sync.clone(), self.telemetry.clone());

        let component = Component::from_file(&self.engine, path)?;
        let mut store = Store::new(&self.engine, TractorStore { wasi, http, bindings, table });

        let plugin =
            RefarmPluginHost::instantiate_async(&mut store, &component, &self.linker).await?;

        plugin
            .refarm_plugin_integration()
            .call_setup(&mut store)
            .await?
            .map_err(|e| anyhow::anyhow!("Plugin setup() failed: {:?}", e))?;

        self.telemetry.emit_named(
            "plugin:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({
                "path": path.to_string_lossy(),
                "wasm_hash": wasm_hash,
            })),
        );

        tracing::info!(plugin_id = %plugin_id, "Plugin loaded and setup() called");
        Ok(PluginInstanceHandle::new(plugin_id, plugin, store))
    }

    /// Load agent-tools.wasm — the composition component that exports agent-fs + agent-shell.
    ///
    /// Uses a dedicated linker with WASI + host-spawn (no tractor-bridge).
    /// The returned `AgentToolsHandle` is stored by the caller (daemon/manager)
    /// for future Fase 3 composition with pi-agent.wasm.
    pub async fn load_agent_tools(&self, path: &Path, sync: &NativeSync) -> Result<AgentToolsHandle> {
        let plugin_id = "agent-tools".to_string();

        tracing::info!(path = %path.display(), "Loading agent-tools.wasm");
        anyhow::ensure!(path.exists(), "agent-tools.wasm not found: {}", path.display());

        let bytes = tokio::fs::read(path).await?;
        let wasm_hash = hex::encode(Sha256::digest(&bytes));

        let wasi = WasiCtxBuilder::new().inherit_stderr().build();
        let table = ResourceTable::new();
        let http = wasmtime_wasi_http::WasiHttpCtx::new();
        let bindings = TractorNativeBindings::new(&plugin_id, sync.clone(), self.telemetry.clone());

        let component = Component::from_file(&self.engine, path)?;
        let mut store = Store::new(&self.engine, TractorStore { wasi, http, bindings, table });

        let agent_tools = atb::AgentToolsHost::instantiate_async(
            &mut store,
            &component,
            &self.agent_tools_linker,
        )
        .await?;

        self.telemetry.emit_named(
            "agent-tools:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({ "wasm_hash": wasm_hash })),
        );

        tracing::info!(wasm_hash = %wasm_hash, "agent-tools.wasm loaded");
        Ok(AgentToolsHandle::new(plugin_id, agent_tools, store))
    }
}
