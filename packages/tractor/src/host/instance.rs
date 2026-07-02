//! PluginInstanceHandle — wraps a live wasmtime plugin instance.
//!
//! Supports two loader paths (ADR-061):
//!   - P2 Component: RefarmPluginHost WIT bindings + Store<TractorStore>
//!   - P1 Module: plain wasmtime::Instance + Store<P1Store>, WASI preview1 ABI

use anyhow::Result;
use wasmtime::Store;

use crate::host::plugin_host::{P1Store, RefarmPluginHost, TractorStore};
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
    inner: PluginImpl,
    telemetry: TelemetryBus,
}

impl PluginInstanceHandle {
    pub(crate) fn new_component(
        id: String,
        plugin: RefarmPluginHost,
        store: Store<TractorStore>,
        telemetry: TelemetryBus,
        provides: Vec<String>,
    ) -> Self {
        Self {
            id,
            state: PluginState::Idle,
            provides,
            inner: PluginImpl::Component { plugin, store },
            telemetry,
        }
    }

    pub(crate) fn new_module(
        id: String,
        instance: wasmtime::Instance,
        store: Store<P1Store>,
        telemetry: TelemetryBus,
        provides: Vec<String>,
    ) -> Self {
        Self {
            id,
            state: PluginState::Idle,
            provides,
            inner: PluginImpl::Module { instance, store },
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
        match &mut self.inner {
            PluginImpl::Component { plugin, store } => {
                plugin
                    .refarm_plugin_integration()
                    .call_on_event(store, event, payload)
                    .await?;
                Ok(())
            }
            PluginImpl::Module { instance, store } => {
                let event_json = serde_json::json!({
                    "event": event,
                    "payload": payload,
                })
                .to_string();
                let len = event_json.len() as i32;

                let alloc_fn = instance.get_func(&mut *store, "alloc").ok_or_else(|| {
                    anyhow::anyhow!("P1 module '{}' must export 'alloc(i32) -> i32'", self.id)
                })?;
                let alloc: wasmtime::TypedFunc<i32, i32> = alloc_fn.typed(&*store)?;
                let ptr = alloc.call(&mut *store, len)?;

                let memory = instance.get_memory(&mut *store, "memory").ok_or_else(|| {
                    anyhow::anyhow!("P1 module '{}' must export 'memory'", self.id)
                })?;
                memory.write(&mut *store, ptr as usize, event_json.as_bytes())?;

                let on_event_fn = instance.get_func(&mut *store, "on_event").ok_or_else(|| {
                    anyhow::anyhow!("P1 module '{}' must export 'on_event(i32, i32)'", self.id)
                })?;
                let on_event: wasmtime::TypedFunc<(i32, i32), ()> = on_event_fn.typed(&*store)?;
                on_event.call(&mut *store, (ptr, len))?;
                Ok(())
            }
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
        let mut store = Store::new(
            &engine,
            P1Store {
                wasi: WasiCtxBuilder::new().build_p1(),
            },
        );
        let instance = Instance::new(&mut store, &module, &[]).expect("instance");

        PluginInstanceHandle::new_module(
            "p1-fixture".to_string(),
            instance,
            store,
            TelemetryBus::new(16),
            vec!["agent:respond".to_string()],
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
