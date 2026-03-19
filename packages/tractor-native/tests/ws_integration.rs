/// Phase 6 integration tests — WebSocket daemon.

use std::sync::Arc;
use tractor_native::{NativeStorage, NativeSync, TelemetryBus};
use tractor_native::daemon::WsServer;
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;

async fn make_server() -> (WsServer, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener); // releases port; WsServer will rebind
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = Arc::new(NativeSync::new(storage, "test").unwrap());
    let telemetry = TelemetryBus::new(100);
    (WsServer::new(sync, port, telemetry), port)
}

#[tokio::test]
async fn ws_server_accepts_connection() {
    let (server, port) = make_server().await;
    tokio::spawn(async move { server.start().await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let url = format!("ws://127.0.0.1:{port}");
    let (_ws, _) = connect_async(&url).await.expect("connection must succeed");
}
