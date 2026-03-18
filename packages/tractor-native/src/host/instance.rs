//! PluginInstanceHandle — wraps a live wasmtime component instance.
//!
//! Mirrors `PluginInstanceHandle` from packages/tractor/src/lib/instance-handle.ts.
//!
//! # Phase 4 — TODO
//! Full wasmtime integration in Phase 4. This is a typed stub.

use anyhow::Result;

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
/// In Phase 4 this wraps a `wasmtime::component::Instance` and the generated
/// `RefarmPlugin` bindings so callers can invoke `setup()`, `ingest()`, etc.
pub struct PluginInstanceHandle {
    pub id: String,
    pub state: PluginState,
    // Phase 4: store + RefarmPlugin bindings
}

impl PluginInstanceHandle {
    /// Call a named lifecycle function on the plugin.
    ///
    /// Phase 4: dispatches to `RefarmPlugin::call_setup()` / `call_ingest()` etc.
    pub async fn call(&mut self, fn_name: &str, _args: Option<serde_json::Value>) -> Result<Option<serde_json::Value>> {
        tracing::debug!(plugin_id = %self.id, fn_name, "Plugin call (Phase 4 stub)");
        self.state = PluginState::Running;
        match fn_name {
            "setup" | "ingest" | "teardown" | "metadata" => {
                tracing::warn!(fn_name, "wasmtime not yet wired — Phase 4 stub returns Ok(None)");
                Ok(None)
            }
            other => {
                anyhow::bail!("unknown plugin function: {other}")
            }
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
