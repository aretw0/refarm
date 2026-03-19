//! tractor-native daemon
//!
//! Standalone binary that boots TractorNative and starts the WebSocket daemon
//! on port 42000 (replacing the farmhand daemon).
//!
//! Usage:
//!   tractor-native [OPTIONS]
//!
//! The WebSocket server speaks the same binary Loro protocol as BrowserSyncClient
//! in packages/sync-loro/src/browser-sync-client.ts — no client-side changes needed.

use anyhow::Result;
use clap::Parser;
use tractor::{TractorNative, TractorNativeConfig, trust::SecurityMode};

#[derive(Parser, Debug)]
#[command(name = "tractor-native", about = "Refarm sovereign WASM plugin host")]
struct Cli {
    /// Storage namespace (maps to ~/.local/share/refarm/{namespace}.db)
    #[arg(long, default_value = "default")]
    namespace: String,

    /// WebSocket daemon port
    #[arg(long, default_value_t = 42000)]
    port: u16,

    /// Security mode: strict | permissive | none
    #[arg(long, default_value = "strict")]
    security_mode: String,

    /// Log level: trace | debug | info | warn | error
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Load a WASM plugin at startup (may be repeated: --plugin a.wasm --plugin b.wasm)
    #[arg(long, value_name = "PATH")]
    plugin: Vec<std::path::PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialise tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| cli.log_level.parse().unwrap_or_default()),
        )
        .init();

    let security_mode = match cli.security_mode.as_str() {
        "permissive" => SecurityMode::Permissive,
        "none" => SecurityMode::None,
        _ => SecurityMode::Strict,
    };

    let config = TractorNativeConfig {
        namespace: cli.namespace.clone(),
        port: cli.port,
        security_mode,
        ..Default::default()
    };

    tracing::info!(namespace = %cli.namespace, port = cli.port, "Starting tractor-native daemon");

    let tractor = TractorNative::boot(config.clone()).await?;

    // Load plugins — isolated failures log WARN but do not abort the daemon
    for path in &cli.plugin {
        match tractor.load_plugin(path).await {
            Ok(_) => tracing::info!(path = %path.display(), "plugin loaded"),
            Err(e) => tracing::warn!(path = %path.display(), "plugin load failed: {e}"),
        }
    }

    // Start WebSocket daemon (replaces farmhand on port 42000)
    daemon::WsServer::new(
        std::sync::Arc::new(tractor.sync.clone()),
        config.port,
        tractor.telemetry.clone(),
    )
    .start()
    .await?;

    tractor.shutdown().await?;
    Ok(())
}

// Bring daemon module into scope for main.rs
use tractor::daemon;
