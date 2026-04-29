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

pub mod daemon;
pub mod host;
pub mod storage;
pub mod sync;
pub(crate) mod streaming;
pub mod telemetry;
pub mod trust;

use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

use tokio::sync::mpsc;

pub use storage::NativeStorage;
pub use sync::NativeSync;
pub use telemetry::TelemetryBus;
pub use trust::{ExecutionProfile, SecurityMode, TrustManager};

/// A message routed from the WebSocket daemon to a loaded agent plugin.
#[derive(Debug)]
pub struct AgentMessage {
    pub event: String,
    pub payload: Option<String>,
}

const SHUTDOWN_EVENT: &str = "__tractor:shutdown";

/// Keyed by plugin_id — each sender reaches the plugin's dedicated runner thread.
pub type AgentChannels = Arc<RwLock<HashMap<String, mpsc::UnboundedSender<AgentMessage>>>>;

/// Top-level configuration for booting a TractorNative instance.
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
}

impl Default for TractorNativeConfig {
    fn default() -> Self {
        Self {
            namespace: "default".to_string(),
            port: 42000,
            security_mode: SecurityMode::Strict,
            telemetry_capacity: 1000,
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
    pub agent_channels: AgentChannels,
    /// Join handles for plugin runner threads, keyed by plugin_id.
    plugin_runner_handles: Arc<RwLock<HashMap<String, std::thread::JoinHandle<()>>>>,
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
        let trust = TrustManager::new();
        let plugins = host::PluginHost::new(trust.clone(), telemetry.clone())?;

        Ok(Self {
            storage,
            sync,
            plugins,
            trust,
            telemetry,
            agent_channels: Arc::new(RwLock::new(HashMap::new())),
            plugin_runner_handles: Arc::new(RwLock::new(HashMap::new())),
            config,
        })
    }

    /// Load and instantiate a WASM plugin from a file path.
    pub async fn load_plugin(&self, path: &Path) -> Result<host::PluginInstanceHandle> {
        self.plugins.load(path, &self.sync).await
    }

    /// Move a loaded plugin handle into a dedicated runner thread and register
    /// its mpsc sender in `agent_channels` for WebSocket prompt routing.
    ///
    /// `PluginInstanceHandle` is `!Send` (wasmtime Store). Each plugin gets its
    /// own thread + single-threaded tokio runtime so the `!Send` constraint is
    /// satisfied without unsafe code.
    pub fn register_for_events(&self, handle: host::PluginInstanceHandle) {
        let plugin_id = handle.id.clone();
        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();

        let id_for_thread = plugin_id.clone();
        let join = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("plugin runner rt");
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let mut h = handle;
                let mut teardown_done = false;
                while let Some(msg) = rx.recv().await {
                    if msg.event == SHUTDOWN_EVENT {
                        h.call_teardown().await;
                        teardown_done = true;
                        break;
                    }

                    if let Err(e) = h.call_on_event(&msg.event, msg.payload.as_deref()).await {
                        tracing::warn!(plugin_id = %id_for_thread, "on_event error: {e}");
                    }
                }

                if !teardown_done {
                    h.call_teardown().await;
                }
                h.terminate();
                tracing::debug!(plugin_id = %id_for_thread, "plugin runner exiting");
            });
        });

        self.agent_channels
            .write()
            .expect("agent_channels poisoned")
            .insert(plugin_id.clone(), tx);

        self.plugin_runner_handles
            .write()
            .expect("plugin_runner_handles poisoned")
            .insert(plugin_id, join);
    }

    /// Shut down all plugins and close storage.
    pub async fn shutdown(&self) -> Result<()> {
        tracing::info!("TractorNative shutting down");

        let senders = {
            let mut guard = self
                .agent_channels
                .write()
                .expect("agent_channels poisoned");
            guard.drain().map(|(_, tx)| tx).collect::<Vec<_>>()
        };

        for tx in &senders {
            let _ = tx.send(AgentMessage {
                event: SHUTDOWN_EVENT.to_string(),
                payload: None,
            });
        }
        drop(senders);

        let joins = {
            let mut guard = self
                .plugin_runner_handles
                .write()
                .expect("plugin_runner_handles poisoned");
            guard.drain().map(|(_, join)| join).collect::<Vec<_>>()
        };

        for join in joins {
            if let Err(panic_payload) = join.join() {
                tracing::warn!("plugin runner thread panic during shutdown: {:?}", panic_payload);
            }
        }

        self.storage.close()?;
        Ok(())
    }
}
