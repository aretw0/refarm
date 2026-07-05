/// Sidecar HTTP protocol tests — ADR-060
///
/// All tests run without a real LLM, without WASM, and without agent loaded.
/// They validate the HTTP surface (status codes, JSON shapes, effort lifecycle)
/// using an in-process sidecar bound on port 0 and an empty AgentChannels map.
///
/// Run: cargo test --lib sidecar_
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tokio::net::TcpListener;

use super::*;

// ── helpers ──────────────────────────────────────────────────────────────────

async fn start_test_sidecar() -> (SidecarState, u16, PathBuf) {
    let tmp = std::env::temp_dir().join(format!("tractor-sidecar-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(
        channels,
        Arc::new(RwLock::new(HashMap::new())), // cancel_flags
        Arc::new(RwLock::new(None)),
        crate::EventRouter::default(),
        crate::TelemetryBus::new(100),
        &tmp,
        ":memory:".to_string(),
    )
    .unwrap();

    // bind on :0 — OS assigns a free port
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route(
            "/efforts",
            axum::routing::post(post_efforts).get(get_efforts),
        )
        .route("/efforts/summary", axum::routing::get(get_efforts_summary))
        .route("/efforts/:id", axum::routing::get(get_effort))
        .route("/efforts/:id/logs", axum::routing::get(get_effort_logs))
        .route("/efforts/:id/retry", axum::routing::post(post_effort_retry))
        .route(
            "/efforts/:id/cancel",
            axum::routing::post(post_effort_cancel),
        )
        .route("/plugins", axum::routing::get(get_plugins))
        .route("/plugins/reload", axum::routing::post(post_plugins_reload))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port, tmp)
}

/// Like start_test_sidecar but backed by a real SQLite FILE namespace, so nodes
/// written by test setup are visible to the respond watcher's own NativeStorage
/// connection (a :memory: db is isolated per connection). Returns the state and
/// the file namespace path.
async fn start_effort_sidecar_ns() -> (SidecarState, u16, PathBuf, String) {
    let tmp = std::env::temp_dir().join(format!("tractor-effort-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let namespace = std::env::temp_dir()
        .join(format!("tractor-effort-ns-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .unwrap()
        .to_owned();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(
        channels,
        Arc::new(RwLock::new(HashMap::new())), // cancel_flags
        Arc::new(RwLock::new(None)),
        crate::EventRouter::default(),
        crate::TelemetryBus::new(100),
        &tmp,
        namespace.clone(),
    )
    .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/efforts", axum::routing::post(post_efforts).get(get_efforts))
        .route("/efforts/summary", axum::routing::get(get_efforts_summary))
        .route("/efforts/:id", axum::routing::get(get_effort))
        .route(
            "/efforts/:id/cancel",
            axum::routing::post(post_effort_cancel),
        )
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port, tmp, namespace)
}

/// Write a terminal (is_final) AgentResponse node carrying `prompt_ref`, as the
/// agent's wasi_bridge does when a respond answer completes.
fn write_agent_response(ns: &str, id: &str, prompt_ref: &str, content: &str, is_final: bool) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    let payload = serde_json::json!({
        "@type": "AgentResponse",
        "@id": id,
        "prompt_ref": prompt_ref,
        "content": content,
        "is_final": is_final,
        "sequence": 0,
        "timestamp_ns": 1_000_000_u64,
    })
    .to_string();
    storage
        .store_node(id, "AgentResponse", None, &payload, None)
        .unwrap();
}

fn test_effort(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "direction": "ask",
        "tasks": [{
            "id": uuid::Uuid::new_v4().to_string(),
            "pluginId": "@refarm/agent",
            "fn": "respond",
            "args": { "prompt": "ping", "system": null }
        }],
        "source": "test",
        "submittedAt": "2026-01-01T00:00:00Z"
    })
}

fn test_effort_with_plugin(id: &str, plugin_id: &str) -> serde_json::Value {
    let mut effort = test_effort(id);
    effort["tasks"][0]["pluginId"] = serde_json::json!(plugin_id);
    effort
}

fn test_task(args: serde_json::Value) -> EffortTask {
    EffortTask {
        id: uuid::Uuid::new_v4().to_string(),
        plugin_id: "@refarm/agent".to_string(),
        fn_name: Some("respond".to_string()),
        args,
    }
}

fn base(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn storage_path() -> String {
    std::env::temp_dir()
        .join(format!("tractor-sessions-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .unwrap()
        .to_owned()
}

// Per-family test modules. tests.rs lives in sidecar/, so `#[path]` must be
// explicitly `tests/<family>.rs` (a bare `mod x;` would look for sidecar/x.rs).
// Each child is body-only and pulls the shared helpers above via `use super::*;`.
#[path = "tests/effort.rs"]
mod effort;
#[path = "tests/session.rs"]
mod session;
#[path = "tests/task.rs"]
mod task;
#[path = "tests/plugin.rs"]
mod plugin;
