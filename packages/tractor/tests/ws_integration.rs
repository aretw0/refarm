/// Phase 6 integration tests — WebSocket daemon.
use std::sync::Arc;
use tractor::{NativeStorage, NativeSync, TelemetryBus};
use tractor::daemon::WsServer;
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
    ws.send(Message::Binary(bytes)).await.unwrap();

    // Poll until the server's read model reflects the update (avoids fixed-sleep flakiness)
    let node = {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        loop {
            let n = server_sync.get_node("urn:test:from-client").unwrap();
            if n.is_some() || std::time::Instant::now() >= deadline {
                break n;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    };
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
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Client A sends a Loro update
    let sender_sync = make_sync("t-broadcast-sender");
    sender_sync.store_node("urn:test:broadcast-1", "Note", None, "{}", None).unwrap();
    let bytes = sender_sync.get_update().unwrap();
    ws_a.send(Message::Binary(bytes)).await.unwrap();

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

#[tokio::test]
async fn ws_server_run_twice_no_duplicate_broadcasts() {
    // Regression test: calling run() twice on the same NativeSync must NOT
    // cause duplicate broadcasts (stale on_update callbacks accumulating).
    let sync = make_sync("t-dedup");

    // Start two servers simultaneously on the same NativeSync (both remain alive —
    // Tokio does not cancel tasks on JoinHandle drop). The second server's
    // set_broadcast_callback replaces the first's, so only one callback fires.
    let _port1 = start_server(sync.clone()).await;
    let port2 = start_server(sync.clone()).await;

    // Connect a client to the second server
    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port2}"))
        .await.unwrap();

    // Discard initial state
    let _ = ws.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // Generate ONE local change on sync
    sync.store_node("urn:test:dedup-1", "Event", None, "{}", None).unwrap();

    // Collect frames received within 300ms — must be exactly 1, not 2
    let mut frames = Vec::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() { break; }
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Binary(_)))) => frames.push(1),
            _ => break,
        }
    }

    assert_eq!(frames.len(), 1, "exactly 1 broadcast expected — got {} (duplicate callbacks accumulating?)", frames.len());
}

#[tokio::test]
async fn ws_server_corrupted_bytes_not_relayed() {
    let sync = make_sync("t-corrupt");
    let port = start_server(sync).await;
    let url = format!("ws://127.0.0.1:{port}");

    let (mut ws_a, _) = connect_async(&url).await.unwrap();
    let (mut ws_b, _) = connect_async(&url).await.unwrap();

    // Discard initial state
    let _ = ws_a.next().await;
    let _ = ws_b.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Client A sends invalid Loro bytes
    ws_a.send(Message::Binary(b"not-valid-loro-bytes".to_vec())).await.unwrap();

    // Client B must NOT receive anything within 300ms
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(300),
        ws_b.next(),
    ).await;

    assert!(result.is_err(), "client B must not receive a corrupted frame");
}

#[tokio::test]
async fn ws_server_empty_frame_not_relayed() {
    let sync = make_sync("t-empty");
    let port = start_server(sync).await;
    let url = format!("ws://127.0.0.1:{port}");

    let (mut ws_a, _) = connect_async(&url).await.unwrap();
    let (mut ws_b, _) = connect_async(&url).await.unwrap();

    // Discard initial state
    let _ = ws_a.next().await;
    let _ = ws_b.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Client A sends an empty binary frame
    ws_a.send(Message::Binary(vec![])).await.unwrap();

    // Client B must NOT receive anything within 300ms
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(300),
        ws_b.next(),
    ).await;

    assert!(result.is_err(), "client B must not receive an empty frame");
}

#[tokio::test]
async fn ws_server_sender_does_not_receive_own_relay() {
    let sync = make_sync("t-no-echo");
    let port = start_server(sync).await;
    let url = format!("ws://127.0.0.1:{port}");

    let (mut ws_a, _) = connect_async(&url).await.unwrap();
    let (mut ws_b, _) = connect_async(&url).await.unwrap();

    // Discard initial state
    let _ = ws_a.next().await;
    let _ = ws_b.next().await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Client A sends a valid update
    let sender_sync = make_sync("t-no-echo-sender");
    sender_sync.store_node("urn:test:echo-1", "Note", None, "{}", None).unwrap();
    let bytes = sender_sync.get_update().unwrap();
    ws_a.send(Message::Binary(bytes)).await.unwrap();

    // Client B must receive the relay
    let msg = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        ws_b.next(),
    ).await.expect("B must receive relay").unwrap().unwrap();
    assert!(matches!(msg, Message::Binary(_)), "relay to B must be binary");

    // Client A must NOT receive its own frame back
    let echo = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        ws_a.next(),
    ).await;
    assert!(echo.is_err(), "sender must not receive its own relay");
}

#[tokio::test]
async fn ws_server_client_disconnect_no_zombie() {
    let sync = make_sync("t-zombie");
    let port = start_server(sync.clone()).await;
    let url = format!("ws://127.0.0.1:{port}");

    // Connect and immediately drop 5 clients
    for _ in 0..5 {
        let (ws, _) = connect_async(&url).await.unwrap();
        drop(ws); // closes the connection
    }

    // Give cleanup tasks time to remove zombies from the client map
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Connect one legitimate client
    let (mut ws, _) = connect_async(&url).await.unwrap();
    let _ = ws.next().await; // discard initial state

    // Server-side local change → broadcast to remaining clients; no panic from zombies
    sync.store_node("urn:test:zombie-check", "Note", None, "{}", None).unwrap();

    let msg = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        ws.next(),
    ).await.expect("legitimate client must receive broadcast").unwrap().unwrap();

    assert!(matches!(msg, Message::Binary(_)), "broadcast must be binary — no zombie panic");
}
