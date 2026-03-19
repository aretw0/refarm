//! WebSocket daemon — replaces farmhand on port 42000.
//!
//! Protocol (binary Loro frames — no JSON, no wrapper):
//!   On connect:  server sends sync.get_update() (full state)
//!                client sends its own getUpdate() immediately after
//!   On recv:     sync.apply_update(bytes) + broadcast to OTHER clients
//!   On local:    sync.on_update fires → broadcast to ALL clients
//!
//! Binary-compatible with BrowserSyncClient (packages/sync-loro/src/browser-sync-client.ts).
//! BrowserSyncClient requires ZERO changes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;

type ClientId = usize;
type ClientMap = Arc<Mutex<HashMap<ClientId, mpsc::UnboundedSender<Vec<u8>>>>>;

static NEXT_CLIENT_ID: AtomicUsize = AtomicUsize::new(0);

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

    /// Start the WebSocket server and block until Ctrl-C.
    pub async fn start(&self) -> Result<()> {
        let addr = format!("0.0.0.0:{}", self.port);
        let listener = TcpListener::bind(&addr).await?;
        self.run(listener).await
    }

    /// Run the server with a pre-bound listener (used directly in tests to avoid TOCTOU).
    pub(crate) async fn run(&self, listener: TcpListener) -> Result<()> {
        tracing::info!(port = self.port, "WebSocket daemon listening");

        self.telemetry.emit_named(
            "daemon:start",
            None,
            Some(serde_json::json!({ "port": self.port })),
        );

        let clients: ClientMap = Arc::new(Mutex::new(HashMap::new()));

        // Wire sync.on_update → broadcast to ALL connected clients
        // (fires only for local changes, e.g. from plugins calling store_node)
        let clients_for_on_update = clients.clone();
        self.sync.on_update(move |bytes| {
            let clients = clients_for_on_update.clone();
            let bytes = bytes.clone();
            // on_update fires synchronously on doc.commit(); spawn to avoid blocking
            tokio::spawn(async move {
                let guard = clients.lock().await;
                for tx in guard.values() {
                    let _ = tx.send(bytes.clone());
                }
            });
        });

        let accept_loop = async {
            loop {
                match listener.accept().await {
                    Ok((tcp_stream, addr)) => {
                        tracing::debug!(%addr, "new connection");
                        let sync = self.sync.clone();
                        let clients = clients.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(tcp_stream, sync, clients).await {
                                tracing::warn!("connection error: {e}");
                            }
                        });
                    }
                    Err(e) => tracing::error!("accept error: {e}"),
                }
            }
        };

        tokio::select! {
            _ = accept_loop => {},
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("Shutdown signal received");
            }
        }
        Ok(())
    }
}

async fn handle_connection(
    tcp_stream: tokio::net::TcpStream,
    sync: Arc<NativeSync>,
    clients: ClientMap,
) -> Result<()> {
    let ws = accept_async(tcp_stream).await?;
    let (mut sink, mut stream) = ws.split();

    // Send current server state immediately on connect
    let initial = sync.get_update()?;
    sink.send(Message::Binary(initial.into())).await?;

    // Register client in map for broadcasts
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    clients.lock().await.insert(client_id, tx);

    // Spawn send task: reads from channel, forwards to websocket sink
    let send_task = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if sink.send(Message::Binary(bytes.into())).await.is_err() {
                break;
            }
        }
    });

    // Recv loop: apply incoming frames + relay to other clients
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                let bytes = bytes.to_vec();
                // Apply to local CRDT (no on_update fires for imports)
                if let Err(e) = sync.apply_update(&bytes) {
                    tracing::error!("apply_update failed: {e}");
                }
                // Relay to all OTHER connected clients
                let guard = clients.lock().await;
                for (&id, tx) in guard.iter() {
                    if id != client_id {
                        let _ = tx.send(bytes.clone());
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {} // ignore ping/pong/text
        }
    }

    // Cleanup
    clients.lock().await.remove(&client_id);
    send_task.abort();
    Ok(())
}
