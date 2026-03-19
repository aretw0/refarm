/// Phase 6 integration tests — WebSocket daemon.

use std::sync::Arc;
use tractor_native::{NativeStorage, NativeSync, TelemetryBus};
use tractor_native::daemon::WsServer;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Start a WsServer on a random OS-assigned port, passing the pre-bound listener
/// directly to server.run() to avoid TOCTOU race conditions.
async fn start_server(sync: Arc<NativeSync>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let telemetry = TelemetryBus::new(100);
    let server = WsServer::new(sync, port, telemetry);
    tokio::spawn(async move { server.run(listener).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    port
}

fn make_sync(peer: &str) -> Arc<NativeSync> {
    let storage = NativeStorage::open(":memory:").unwrap();
    Arc::new(NativeSync::new(storage, peer).unwrap())
}

#[tokio::test]
async fn ws_server_accepts_connection() {
    let sync = make_sync("t-accept");
    let port = start_server(sync).await;
    let (_ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await.expect("must connect");
}

#[tokio::test]
async fn ws_server_sends_state_on_connect() {
    let sync = make_sync("t-send");
    // Store a node BEFORE connecting
    sync.store_node("urn:test:pre-1", "Note", None, "{}", None).unwrap();
    let port = start_server(sync).await;

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await.unwrap();

    // First message from server must be non-empty binary (current state)
    let msg = ws.next().await.unwrap().unwrap();
    assert!(matches!(msg, Message::Binary(_)), "first message must be binary");
    if let Message::Binary(bytes) = msg {
        assert!(!bytes.is_empty(), "state bytes must be non-empty");
        // Must be importable by a fresh LoroDoc
        let doc = loro::LoroDoc::new();
        doc.import(&bytes).expect("server state must be valid Loro bytes");
    }
}

#[tokio::test]
async fn ws_server_applies_incoming_update() {
    let server_sync = make_sync("t-apply-server");
    let port = start_server(server_sync.clone()).await;

    // Client has a node to send
    let client_sync = make_sync("t-apply-client");
    client_sync.store_node("urn:test:from-client", "Task", None, "{}", None).unwrap();

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await.unwrap();

    // Read and discard the server's initial state
    let _ = ws.next().await;

    // Send client state to server
    let bytes = client_sync.get_update().unwrap();
    ws.send(Message::Binary(bytes.into())).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Server's NativeSync must now have the node in its read model
    let node = server_sync.get_node("urn:test:from-client").unwrap();
    assert!(node.is_some(), "server must have node after receiving client update");
}

#[tokio::test]
async fn ws_server_broadcasts_to_other_clients() {
    let sync = make_sync("t-broadcast");
    let port = start_server(sync).await;

    let url = format!("ws://127.0.0.1:{port}");

    // Connect two clients
    let (mut ws_a, _) = connect_async(&url).await.unwrap();
    let (mut ws_b, _) = connect_async(&url).await.unwrap();

    // Discard initial state messages from server
    let _ = ws_a.next().await;
    let _ = ws_b.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    // Client A sends a Loro update
    let sender_sync = make_sync("t-broadcast-sender");
    sender_sync.store_node("urn:test:broadcast-1", "Note", None, "{}", None).unwrap();
    let bytes = sender_sync.get_update().unwrap();
    ws_a.send(Message::Binary(bytes.into())).await.unwrap();

    // Client B must receive the relayed frame
    let msg = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        ws_b.next(),
    ).await.expect("timeout waiting for broadcast").unwrap().unwrap();

    assert!(matches!(msg, Message::Binary(_)), "broadcast must be binary");
}

#[tokio::test]
async fn ws_server_on_update_broadcasts_local_changes() {
    let sync = make_sync("t-local");
    let port = start_server(sync.clone()).await;

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await.unwrap();

    // Discard initial state
    let _ = ws.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Server generates a LOCAL change (simulates plugin writing to store_node)
    sync.store_node("urn:test:local-1", "Event", None, "{}", None).unwrap();

    // Connected client must receive the delta via on_update broadcast
    let msg = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        ws.next(),
    ).await.expect("timeout waiting for local update broadcast").unwrap().unwrap();

    assert!(matches!(msg, Message::Binary(_)), "local update must be broadcast as binary");
}
