//! tractor-native — Sovereign WASM plugin host
//!
//! Native Rust implementation of the Refarm Tractor. Designed for:
//!   - Edge / RPi agents (~10 MB binary, no Node.js/V8)
//!   - Tauri desktop applications (embedded library)
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
pub mod telemetry;
pub mod trust;

use anyhow::Result;
use std::path::Path;

pub use storage::NativeStorage;
pub use sync::NativeSync;
pub use telemetry::TelemetryBus;
pub use trust::{ExecutionProfile, SecurityMode, TrustManager};

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
            config,
        })
    }

    /// Load and instantiate a WASM plugin from a file path.
    pub async fn load_plugin(&self, path: &Path) -> Result<host::PluginInstanceHandle> {
        self.plugins.load(path, &self.sync).await
    }

    /// Shut down all plugins and close storage.
    pub async fn shutdown(&self) -> Result<()> {
        tracing::info!("TractorNative shutting down");
        self.storage.close()?;
        Ok(())
    }
}
