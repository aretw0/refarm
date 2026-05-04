/// Sidecar HTTP protocol tests — ADR-060
///
/// All tests run without a real LLM, without WASM, and without pi-agent loaded.
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
    let tmp = std::env::temp_dir().join(format!(
        "tractor-sidecar-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(channels, &tmp, ":memory:".to_string()).unwrap();

    // bind on :0 — OS assigns a free port
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/efforts", axum::routing::post(post_efforts).get(get_efforts))
        .route("/efforts/summary", axum::routing::get(get_efforts_summary))
        .route("/efforts/:id", axum::routing::get(get_effort))
        .route("/efforts/:id/logs", axum::routing::get(get_effort_logs))
        .route("/efforts/:id/retry", axum::routing::post(post_effort_retry))
        .route("/efforts/:id/cancel", axum::routing::post(post_effort_cancel))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port, tmp)
}

fn test_effort(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "direction": "ask",
        "tasks": [{
            "id": uuid::Uuid::new_v4().to_string(),
            "pluginId": "@refarm/pi-agent",
            "fn": "respond",
            "args": { "prompt": "ping", "system": null }
        }],
        "source": "test",
        "submittedAt": "2026-01-01T00:00:00Z"
    })
}

fn base(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

// ── protocol tests ────────────────────────────────────────────────────────────

#[tokio::test]
async fn sidecar_post_efforts_returns_effort_id() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let effort_id = uuid::Uuid::new_v4().to_string();

    let res = client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&effort_id))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["effortId"].as_str().unwrap(), effort_id);
}

#[tokio::test]
async fn sidecar_get_efforts_lists_submitted() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let res = client
        .get(format!("{}/efforts", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let list: serde_json::Value = res.json().await.unwrap();
    let arr = list.as_array().unwrap();
    assert!(!arr.is_empty(), "effort list should contain the submitted effort");
    let ids: Vec<&str> = arr
        .iter()
        .filter_map(|e| e["effortId"].as_str())
        .collect();
    assert!(ids.contains(&id.as_str()));
}

#[tokio::test]
async fn sidecar_get_effort_by_id_returns_result() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let res = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["effortId"].as_str().unwrap(), id);
    assert!(body.get("status").is_some());
}

#[tokio::test]
async fn sidecar_get_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .get(format!("{}/efforts/nonexistent-id", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.get("error").is_some());
}

#[tokio::test]
async fn sidecar_summary_reflects_submitted_efforts() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    for _ in 0..3 {
        client
            .post(format!("{}/efforts", base(port)))
            .json(&test_effort(&uuid::Uuid::new_v4().to_string()))
            .send()
            .await
            .unwrap();
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let res = client
        .get(format!("{}/efforts/summary", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    let total = body["total"].as_u64().unwrap_or(0);
    assert!(total >= 3, "summary total should include all submitted efforts");
}

#[tokio::test]
async fn sidecar_get_logs_returns_array() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    let res = client
        .get(format!("{}/efforts/{id}/logs", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.is_array(), "logs must return an array");
}

#[tokio::test]
async fn sidecar_retry_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/efforts/nonexistent/retry", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn sidecar_cancel_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/efforts/nonexistent/cancel", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn sidecar_no_plugin_writes_error_stream_chunk() {
    // No agent channel registered → pi-agent not loaded.
    // The sidecar must write an is_final=true error chunk so refarm ask doesn't timeout.
    let (_state, port, tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    // give the async dispatch task time to run
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let streams_dir = tmp.join("streams");
    let found = std::fs::read_dir(&streams_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("ndjson") {
                return false;
            }
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            content.contains("\"is_final\":true")
        });

    assert!(found, "sidecar must write an is_final stream chunk when plugin is not loaded");
}

#[tokio::test]
async fn sidecar_effort_status_is_failed_when_no_plugin() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let body: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body["status"].as_str().unwrap(),
        "failed",
        "effort must be failed when @refarm/pi-agent channel is not registered"
    );
}
