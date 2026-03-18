//! PluginInstanceHandle — wraps a live wasmtime component instance.
//!
//! Mirrors `PluginInstanceHandle` from packages/tractor/src/lib/instance-handle.ts.
//!
//! Phase 4: Holds `RefarmPluginHost` (generated bindings) + `Store<TractorStore>`
//! so callers can invoke setup(), ingest(), teardown(), etc. on the live plugin.
//!
//! Note: `wasmtime::Store<T>` is `!Send`, so `PluginInstanceHandle` is `!Send`.
//! This matches the TS `MainThreadRunner` model — each plugin runs on one thread.

use anyhow::Result;
use wasmtime::Store;

use crate::host::plugin_host::{RefarmPluginHost, TractorStore};

/// The runtime state of a loaded plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginState {
    Idle,
    Running,
    Hot,
    Throttled,
    Error,
}

/// A handle to a live plugin instance.
///
/// Wraps the wasmtime-generated `RefarmPluginHost` bindings and the `Store`
/// that holds all per-plugin WASI context and bridge state.
pub struct PluginInstanceHandle {
    pub id: String,
    pub state: PluginState,
    plugin: RefarmPluginHost,
    store: Store<TractorStore>,
}

impl PluginInstanceHandle {
    pub fn new(id: String, plugin: RefarmPluginHost, store: Store<TractorStore>) -> Self {
        Self {
            id,
            state: PluginState::Idle,
            plugin,
            store,
        }
    }

    // ── Typed lifecycle methods ───────────────────────────────────────────────

    /// Call the plugin's `setup()` export.
    pub async fn call_setup(&mut self) -> Result<()> {
        self.state = PluginState::Running;
        self.plugin
            .refarm_plugin_integration()
            .call_setup(&mut self.store)
            .await?
            .map_err(|e| anyhow::anyhow!("setup() error: {:?}", e))?;
        self.state = PluginState::Idle;
        Ok(())
    }

    /// Call the plugin's `ingest()` export. Returns the count of ingested nodes.
    pub async fn call_ingest(&mut self) -> Result<u32> {
        self.state = PluginState::Running;
        let count = self.plugin
            .refarm_plugin_integration()
            .call_ingest(&mut self.store)
            .await?
            .map_err(|e| anyhow::anyhow!("ingest() error: {:?}", e))?;
        self.state = PluginState::Idle;
        Ok(count)
    }

    /// Call the plugin's `teardown()` export.
    pub async fn call_teardown(&mut self) {
        let _ = self.plugin
            .refarm_plugin_integration()
            .call_teardown(&mut self.store)
            .await;
        self.state = PluginState::Idle;
    }

    /// Call the plugin's `metadata()` export.
    pub async fn call_metadata(&mut self) -> Result<serde_json::Value> {
        let meta = self.plugin
            .refarm_plugin_integration()
            .call_metadata(&mut self.store)
            .await?;
        Ok(serde_json::json!({
            "name": meta.name,
            "version": meta.version,
            "description": meta.description,
            "supportedTypes": meta.supported_types,
            "requiredCapabilities": meta.required_capabilities,
        }))
    }

    /// Call the plugin's `on-event()` export.
    pub async fn call_on_event(&mut self, event: &str, payload: Option<&str>) -> Result<()> {
        self.plugin
            .refarm_plugin_integration()
            .call_on_event(&mut self.store, event, payload)
            .await?;
        Ok(())
    }

    // ── Generic dispatcher (for TS-parity API) ────────────────────────────────

    /// Dispatch a named lifecycle call. Used by higher-level APIs.
    pub async fn call(&mut self, fn_name: &str, _args: Option<serde_json::Value>) -> Result<Option<serde_json::Value>> {
        tracing::debug!(plugin_id = %self.id, fn_name, "Plugin call");
        match fn_name {
            "setup"    => { self.call_setup().await?; Ok(None) }
            "ingest"   => { let n = self.call_ingest().await?; Ok(Some(serde_json::json!(n))) }
            "teardown" => { self.call_teardown().await; Ok(None) }
            "metadata" => { let m = self.call_metadata().await?; Ok(Some(m)) }
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
        f.debug_struct("PluginInstanceHandle")
            .field("id", &self.id)
            .field("state", &self.state)
            .finish()
    }
}
