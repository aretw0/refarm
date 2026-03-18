//! PluginHost — wasmtime Component loader + Linker + lifecycle orchestration.
//!
//! Mirrors `PluginHost` from packages/tractor/src/lib/plugin-host.ts.
//!
//! # Phase 4 — WIT bindings (wasmtime::component::bindgen!)
//!
//! ```rust,ignore
//! wasmtime::component::bindgen!({
//!     world: "refarm-plugin",
//!     path: "wit",          // wit/refarm-sdk.wit
//!     async: true,
//! });
//! // Generates: RefarmPlugin (call exports), RefarmPluginImports trait (host implements)
//! ```
//!
//! Until Phase 4, this is a typed stub that compiles and accepts the correct types.

use std::path::Path;
use anyhow::Result;
use crate::host::instance::PluginInstanceHandle;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::trust::TrustManager;

/// Orchestrates WASM plugin loading and lifecycle via wasmtime.
///
/// Holds the wasmtime Engine (shared, expensive to create) and manages
/// active plugin instances.
#[derive(Clone, Debug)]
pub struct PluginHost {
    trust: TrustManager,
    telemetry: TelemetryBus,
    // Phase 4: wasmtime::Engine (Arc<Engine>)
    // Phase 4: HashMap<String, PluginInstanceHandle> active instances
}

impl PluginHost {
    pub fn new(trust: TrustManager, telemetry: TelemetryBus) -> Self {
        Self { trust, telemetry }
    }

    /// Load a WASM plugin from a `.wasm` file path.
    ///
    /// Phase 4 full implementation:
    /// 1. `wasmtime::Engine::new(&config)` with component-model feature
    /// 2. `Component::from_file(&engine, path)` — parse WASM component
    /// 3. `Linker::new(&engine)` + `wasmtime_wasi::add_to_linker_async()`
    /// 4. Register `tractor-bridge` host functions via `TractorNativeBindings`
    /// 5. `RefarmPlugin::instantiate_async(&store, &component, &linker)`
    /// 6. Call `plugin.call_setup(&mut store)` — plugin lifecycle start
    pub async fn load(&self, path: &Path, sync: &NativeSync) -> Result<PluginInstanceHandle> {
        let plugin_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        tracing::info!(plugin_id = %plugin_id, path = %path.display(), "Loading plugin (Phase 4 stub)");

        // Phase 4: replace with real wasmtime instantiation
        anyhow::ensure!(path.exists(), "Plugin file not found: {}", path.display());

        self.telemetry.emit_named(
            "plugin:loaded",
            Some(plugin_id.clone()),
            Some(serde_json::json!({ "path": path.to_string_lossy() })),
        );

        Ok(PluginInstanceHandle {
            id: plugin_id,
            state: crate::host::instance::PluginState::Idle,
        })
    }
}
