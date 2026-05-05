//! WebSocket daemon — replaces farmhand on port 42000.
//!
//! Protocol:
//!   Binary frames: Loro CRDT sync (BrowserSyncClient-compatible, unchanged)
//!   Text frames:   JSON agent messages `{ "type": "user:prompt", "agent": "<id>", "payload": "..." }`
//!
//!   On connect:  server sends sync.get_update() (full state)
//!                client sends its own getUpdate() immediately after
//!   On recv binary: sync.apply_update(bytes) + broadcast to OTHER clients
//!   On recv text:   route to plugin runner thread via AgentChannels mpsc
//!   On local:    sync.set_broadcast_callback fires → broadcast to ALL clients
//!
//! Binary path is unchanged and BrowserSyncClient requires ZERO changes.

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
use crate::{AgentChannels, AgentMessage};

type ClientId = usize;
type ClientMap = Arc<Mutex<HashMap<ClientId, mpsc::UnboundedSender<Vec<u8>>>>>;

static NEXT_CLIENT_ID: AtomicUsize = AtomicUsize::new(0);

/// WebSocket server — the farmhand replacement.
pub struct WsServer {
    sync: Arc<NativeSync>,
    port: u16,
    telemetry: TelemetryBus,
    agent_channels: AgentChannels,
}

impl WsServer {
    pub fn new(sync: Arc<NativeSync>, port: u16, telemetry: TelemetryBus, agent_channels: AgentChannels) -> Self {
        Self { sync, port, telemetry, agent_channels }
    }

    /// Start the WebSocket server and block until Ctrl-C.
    pub async fn start(&self) -> Result<()> {
        let addr = format!("0.0.0.0:{}", self.port);
        let listener = TcpListener::bind(&addr).await?;
        self.run(listener).await
    }

    /// Run the server with a pre-bound listener (used directly in tests to avoid TOCTOU).
    pub async fn run(&self, listener: TcpListener) -> Result<()> {
        tracing::info!(port = self.port, "WebSocket daemon listening");

        self.telemetry.emit_named(
            "daemon:start",
            None,
            Some(serde_json::json!({ "port": self.port })),
        );

        let clients: ClientMap = Arc::new(Mutex::new(HashMap::new()));

        // Wire sync.set_broadcast_callback → broadcast to ALL connected clients
        // (fires only for local changes, e.g. from plugins calling store_node)
        // Using set_broadcast_callback replaces any previous subscription, preventing
        // duplicate broadcasts if run() is called more than once on the same NativeSync.
        let clients_for_on_update = clients.clone();
        self.sync.set_broadcast_callback(move |bytes| {
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
                        let agent_channels = self.agent_channels.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(tcp_stream, sync, clients, agent_channels).await {
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
    agent_channels: AgentChannels,
) -> Result<()> {
    let ws = accept_async(tcp_stream).await?;
    let (mut sink, mut stream) = ws.split();

    // Send current server state immediately on connect
    let initial = sync.get_update()?;
    sink.send(Message::Binary(initial)).await?;

    // Register client in map for broadcasts
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    clients.lock().await.insert(client_id, tx);

    // Spawn send task: reads from channel, forwards to websocket sink
    let send_task = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if sink.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
    });

    // Recv loop: apply incoming frames + relay to other clients
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                let bytes = bytes.to_vec();
                // Apply to local CRDT (no on_update fires for imports).
                // Only relay to other clients if the frame was valid — a corrupted
                // frame must not cascade to other peers.
                match sync.apply_update(&bytes) {
                    Ok(()) => {
                        let guard = clients.lock().await;
                        for (&id, tx) in guard.iter() {
                            if id != client_id {
                                let _ = tx.send(bytes.clone());
                            }
                        }
                    }
                    Err(e) => tracing::warn!("apply_update failed (frame discarded, not relayed): {e}"),
                }
            }
            Ok(Message::Text(json)) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&json) {
                    if msg.get("type").and_then(|v| v.as_str()) == Some("user:prompt") {
                        let agent = msg.get("agent").and_then(|v| v.as_str()).unwrap_or("").to_owned();
                        let payload = msg.get("payload").and_then(|v| v.as_str()).map(str::to_owned);
                        let guard = agent_channels.read().expect("agent_channels poisoned");
                        match guard.get(&agent) {
                            Some(tx) => { let _ = tx.send(AgentMessage { event: "user:prompt".into(), payload }); }
                            None => tracing::warn!(agent, "user:prompt: no plugin registered for agent"),
                        }
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {} // ignore ping/pong
        }
    }

    // Cleanup: close channel (drop tx) so send task drains, then await it
    let removed_tx = clients.lock().await.remove(&client_id);
    drop(removed_tx); // closes the mpsc channel
    let _ = send_task.await; // wait for send task to exit cleanly
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, RwLock};
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio::time::timeout;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    use crate::{AgentMessage, NativeStorage, NativeSync, TelemetryBus};

    fn make_sync() -> Arc<NativeSync> {
        let storage = NativeStorage::open(":memory:").unwrap();
        Arc::new(NativeSync::new(storage, ":memory:").unwrap())
    }

    /// Bind on an ephemeral port, start the server in a background task.
    /// Returns the `ws://` address so tests can connect immediately.
    async fn spawn_server(channels: AgentChannels) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = WsServer::new(make_sync(), 0, TelemetryBus::new(10), channels);
        tokio::spawn(async move { let _ = server.run(listener).await; });
        format!("ws://{addr}")
    }

    // ── happy path ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn json_prompt_routes_to_registered_agent() {
        let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();
        channels.write().unwrap().insert("pi-agent".to_string(), tx);

        let addr = spawn_server(channels).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"pi-agent","payload":"olá pi"}"#.to_string(),
        ))
        .await
        .unwrap();

        let msg = timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timed out waiting for agent message")
            .expect("channel closed");

        assert_eq!(msg.event, "user:prompt");
        assert_eq!(msg.payload.as_deref(), Some("olá pi"));
    }

    #[tokio::test]
    async fn initial_state_frame_is_binary() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (_sink, mut stream) = ws.split();
        let first = stream.next().await.unwrap().unwrap();
        assert!(matches!(first, Message::Binary(_)), "expected Binary CRDT frame on connect");
    }

    // ── resilience ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn json_prompt_unknown_agent_ignored_no_crash() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        // Unknown agent — server must warn and continue, not crash.
        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"nobody","payload":"x"}"#.to_string(),
        ))
        .await
        .unwrap();

        // Second message proves the connection and server are still alive.
        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"nobody","payload":"y"}"#.to_string(),
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn malformed_json_silently_ignored() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        sink.send(Message::Text("not json !!!".to_string())).await.unwrap();
        sink.send(Message::Text("{}".to_string())).await.unwrap();
        // no panic, no error — test passes by reaching this line
    }

    #[tokio::test]
    async fn wrong_type_field_not_routed() {
        let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();
        channels.write().unwrap().insert("pi-agent".to_string(), tx);

        let addr = spawn_server(channels).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        // Different "type" value — must NOT route to the agent.
        sink.send(Message::Text(
            r#"{"type":"some:other","agent":"pi-agent","payload":"ignored"}"#.to_string(),
        ))
        .await
        .unwrap();

        let result = timeout(Duration::from_millis(100), rx.recv()).await;
        assert!(result.is_err(), "non-prompt type must not route to agent channel");
    }
}
