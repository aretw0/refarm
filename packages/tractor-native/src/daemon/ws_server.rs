//! WebSocket daemon — replaces farmhand on port 42000.
//!
//! Speaks the same binary Loro protocol as `BrowserSyncClient` in
//! packages/sync-loro/src/browser-sync-client.ts.
//!
//! Protocol:
//!   RECV binary frame → doc.import(bytes) → project to rusqlite → broadcast delta
//!   SEND binary frame → doc.export(Updates) on connect + delta subscriptions
//!
//! `BrowserSyncClient` requires ZERO changes — it already speaks this protocol.
//!
//! # Phase 6 — TODO
//! Full implementation in Phase 6. This stub starts and binds the port.

use std::sync::Arc;
use anyhow::Result;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;

/// WebSocket server — the farmhand replacement.
pub struct WsServer {
    sync: Arc<NativeSync>,
    port: u16,
    telemetry: TelemetryBus,
}

impl WsServer {
    pub fn new(sync: Arc<NativeSync>, port: u16, telemetry: TelemetryBus) -> Self {
        Self { sync, port, telemetry }
    }

    /// Start the WebSocket server and block until shutdown.
    ///
    /// Phase 6 implementation:
    /// - Bind `0.0.0.0:{port}` with tokio-tungstenite
    /// - Accept connections; send current Loro state on connect
    /// - Recv binary frames → `sync.apply_update(bytes)`
    /// - Subscribe to `sync.on_update()` → broadcast to all peers
    /// - Graceful shutdown via `tokio::signal::ctrl_c()`
    pub async fn start(&self) -> Result<()> {
        tracing::info!(
            port = self.port,
            "WebSocket daemon starting (Phase 6 stub — not yet accepting connections)"
        );

        self.telemetry.emit_named(
            "daemon:start",
            None,
            Some(serde_json::json!({ "port": self.port })),
        );

        // Phase 6: replace with real tokio-tungstenite accept loop
        // For now: wait for Ctrl-C so the binary doesn't exit immediately
        tokio::signal::ctrl_c().await?;
        tracing::info!("Shutdown signal received");
        Ok(())
    }
}
