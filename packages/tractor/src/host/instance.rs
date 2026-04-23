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
use crate::telemetry::TelemetryBus;

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
    telemetry: TelemetryBus,
}

impl PluginInstanceHandle {
    pub(crate) fn new(
        id: String,
        plugin: RefarmPluginHost,
        store: Store<TractorStore>,
        telemetry: TelemetryBus,
    ) -> Self {
        Self {
            id,
            state: PluginState::Idle,
            plugin,
            store,
            telemetry,
        }
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
    pub async fn call_setup(&mut self) -> Result<()> {
        self.emit_lifecycle_event("start", "setup", None);
        self.state = PluginState::Running;
        let result = self
            .plugin
            .refarm_plugin_integration()
            .call_setup(&mut self.store)
            .await;

        match result {
            Ok(Ok(())) => {
                self.state = PluginState::Idle;
                self.emit_lifecycle_event("end", "setup", None);
                Ok(())
            }
            Ok(Err(e)) => {
                self.state = PluginState::Error;
                let message = format!("setup() error: {:?}", e);
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
    pub async fn call_ingest(&mut self) -> Result<u32> {
        self.emit_lifecycle_event("start", "ingest", None);
        self.state = PluginState::Running;
        let result = self
            .plugin
            .refarm_plugin_integration()
            .call_ingest(&mut self.store)
            .await;

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
                let message = format!("ingest() error: {:?}", e);
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
    pub async fn call_teardown(&mut self) {
        self.emit_lifecycle_event("start", "teardown", None);
        self.state = PluginState::Running;
        let result = self
            .plugin
            .refarm_plugin_integration()
            .call_teardown(&mut self.store)
            .await;
        match result {
            Ok(()) => {
                self.state = PluginState::Idle;
                self.emit_lifecycle_event("end", "teardown", None);
            }
            Err(e) => {
                self.state = PluginState::Error;
                let message = format!("teardown() trap: {e}");
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
