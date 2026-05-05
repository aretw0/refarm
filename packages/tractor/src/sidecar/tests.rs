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

// ── session history tests ─────────────────────────────────────────────────────
//
// These tests use a real SQLite file (not :memory:) so that nodes written in
// test setup are visible when the handler opens its own NativeStorage connection.

fn storage_path() -> String {
    std::env::temp_dir()
        .join(format!("tractor-sessions-{}.db", uuid::Uuid::new_v4()))
        .to_str()
        .unwrap()
        .to_owned()
}

async fn start_history_sidecar(namespace: &str) -> (SidecarState, u16) {
    let tmp = std::env::temp_dir().join(format!("tractor-hist-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(channels, &tmp, namespace.to_string()).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/sessions", axum::routing::post(post_session_new).get(get_sessions))
        .route("/sessions/:id/fork", axum::routing::post(post_session_fork))
        .route("/sessions/:id/history", axum::routing::get(get_session_history))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port)
}

fn write_session(ns: &str, id: &str, leaf_entry_id: Option<&str>) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    let payload = serde_json::json!({
        "@type": "Session",
        "@id": id,
        "leaf_entry_id": leaf_entry_id,
        "created_at_ns": 1_000_000_u64,
    })
    .to_string();
    storage.store_node(id, "Session", None, &payload, None).unwrap();
}

fn write_entry(ns: &str, id: &str, kind: &str, content: &str, parent: Option<&str>, ts: u64) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    let payload = serde_json::json!({
        "@type": "SessionEntry",
        "@id": id,
        "kind": kind,
        "content": content,
        "parent_entry_id": parent.unwrap_or(""),
        "timestamp_ns": ts,
    })
    .to_string();
    storage.store_node(id, "SessionEntry", None, &payload, None).unwrap();
}

#[tokio::test]
async fn sidecar_session_history_unknown_id_returns_404() {
    let ns = storage_path();
    let (_state, port) = start_history_sidecar(&ns).await;

    let resp = reqwest::get(format!("{}/sessions/no-such-session/history", base(port)))
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn sidecar_session_history_no_entries_returns_empty() {
    let ns = storage_path();
    let session_id = "urn:refarm:session:v1:empty";
    write_session(&ns, session_id, None);
    let (_state, port) = start_history_sidecar(&ns).await;

    // colons are valid in URL path segments (RFC 3986)
    let body: serde_json::Value =
        reqwest::get(format!("{}/sessions/{}/history", base(port), session_id))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    assert_eq!(body["total"].as_u64().unwrap(), 0);
    assert!(body["entries"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn sidecar_session_history_returns_entries_oldest_first() {
    let ns = storage_path();
    let sid = "urn:refarm:session:v1:hist01";
    let e1 = "urn:refarm:entry:v1:e001";
    let e2 = "urn:refarm:entry:v1:e002";

    // e1 (user, oldest) → e2 (assistant, newest), leaf = e2
    write_entry(&ns, e1, "user", "hello world", None, 1_000);
    write_entry(&ns, e2, "assistant", "hi there", Some(e1), 2_000);
    write_session(&ns, sid, Some(e2));

    let (_state, port) = start_history_sidecar(&ns).await;

    let body: serde_json::Value =
        reqwest::get(format!("{}/sessions/{}/history", base(port), sid))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    assert_eq!(body["total"].as_u64().unwrap(), 2, "two entries");
    let entries = body["entries"].as_array().unwrap();
    assert_eq!(entries[0]["kind"].as_str().unwrap(), "user", "oldest first");
    assert_eq!(entries[0]["content"].as_str().unwrap(), "hello world");
    assert_eq!(entries[1]["kind"].as_str().unwrap(), "assistant");
    assert_eq!(entries[1]["content"].as_str().unwrap(), "hi there");
}

#[tokio::test]
async fn sidecar_session_history_prefix_resolves_unique_session() {
    let ns = storage_path();
    let sid = "urn:refarm:session:v1:uniq99";
    write_session(&ns, sid, None);
    let (_state, port) = start_history_sidecar(&ns).await;

    // pass only the short suffix as prefix
    let resp = reqwest::get(format!("{}/sessions/uniq99/history", base(port)))
        .await
        .unwrap();

    assert_eq!(resp.status(), 200, "prefix should resolve to unique session");
}

#[tokio::test]
async fn sidecar_session_history_ambiguous_prefix_returns_409() {
    let ns = storage_path();
    write_session(&ns, "urn:refarm:session:v1:ambig-alpha", None);
    write_session(&ns, "urn:refarm:session:v1:ambig-beta", None);
    let (_state, port) = start_history_sidecar(&ns).await;

    let resp = reqwest::get(format!("{}/sessions/ambig/history", base(port)))
        .await
        .unwrap();

    assert_eq!(resp.status(), 409, "ambiguous prefix must return 409");
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["matches"].as_array().unwrap().len() >= 2);
}

// ── session fork tests ────────────────────────────────────────────────────────

#[tokio::test]
async fn sidecar_session_fork_creates_child_session() {
    let ns = storage_path();
    let sid = "urn:refarm:session:v1:parent01";
    let e1 = "urn:refarm:entry:v1:p01e1";
    write_entry(&ns, e1, "user", "hello", None, 1_000);
    write_session(&ns, sid, Some(e1));
    let (_state, port) = start_history_sidecar(&ns).await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/sessions/{sid}/fork", base(port)))
        .json(&serde_json::json!({ "name": "test-fork" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let fork = &body["session"];
    assert_eq!(fork["parent_session_id"].as_str().unwrap(), sid);
    assert_eq!(fork["leaf_entry_id"].as_str().unwrap(), e1, "inherits leaf from parent");
    assert_eq!(fork["name"].as_str().unwrap(), "test-fork");
    assert!(fork["@id"].as_str().unwrap().starts_with("urn:refarm:session:v1:"));
}

#[tokio::test]
async fn sidecar_session_fork_at_explicit_entry() {
    let ns = storage_path();
    let sid = "urn:refarm:session:v1:parent02";
    let e1 = "urn:refarm:entry:v1:p02e1";
    let e2 = "urn:refarm:entry:v1:p02e2";
    write_entry(&ns, e1, "user", "first", None, 1_000);
    write_entry(&ns, e2, "agent", "reply", Some(e1), 2_000);
    write_session(&ns, sid, Some(e2));
    let (_state, port) = start_history_sidecar(&ns).await;

    let client = reqwest::Client::new();
    let body: serde_json::Value = client
        .post(format!("{}/sessions/{sid}/fork", base(port)))
        .json(&serde_json::json!({ "entry_id": e1 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body["session"]["leaf_entry_id"].as_str().unwrap(),
        e1,
        "fork must branch at the specified entry, not the current leaf"
    );
}

#[tokio::test]
async fn sidecar_session_fork_unknown_session_returns_404() {
    let ns = storage_path();
    let (_state, port) = start_history_sidecar(&ns).await;

    let resp = reqwest::Client::new()
        .post(format!("{}/sessions/ghost-session/fork", base(port)))
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

// ── session create tests ──────────────────────────────────────────────────────

#[tokio::test]
async fn sidecar_post_session_creates_unnamed_session() {
    let ns = storage_path();
    let (_state, port) = start_history_sidecar(&ns).await;

    let resp = reqwest::Client::new()
        .post(format!("{}/sessions", base(port)))
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let session = &body["session"];
    assert!(session["@id"].as_str().unwrap().starts_with("urn:refarm:session:v1:"));
    assert!(session["leaf_entry_id"].is_null());
    assert!(session["parent_session_id"].is_null());
}

#[tokio::test]
async fn sidecar_post_session_creates_named_session() {
    let ns = storage_path();
    let (_state, port) = start_history_sidecar(&ns).await;

    let resp = reqwest::Client::new()
        .post(format!("{}/sessions", base(port)))
        .json(&serde_json::json!({ "name": "auth-refactor" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["session"]["name"].as_str().unwrap(), "auth-refactor");
}

#[tokio::test]
async fn sidecar_post_session_appears_in_list() {
    let ns = storage_path();
    let (_state, port) = start_history_sidecar(&ns).await;
    let client = reqwest::Client::new();

    // Create a named session.
    let created: serde_json::Value = client
        .post(format!("{}/sessions", base(port)))
        .json(&serde_json::json!({ "name": "list-test" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let new_id = created["session"]["@id"].as_str().unwrap().to_owned();

    // It must appear in GET /sessions.
    let list: serde_json::Value = client
        .get(format!("{}/sessions", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sessions = list["sessions"].as_array().unwrap();
    assert!(
        sessions.iter().any(|s| s["@id"].as_str() == Some(&new_id)),
        "newly created session must appear in list"
    );
}

// ── task endpoint tests ───────────────────────────────────────────────────────

async fn start_tasks_sidecar(namespace: &str) -> (SidecarState, u16) {
    let tmp = std::env::temp_dir().join(format!("tractor-tasks-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(channels, &tmp, namespace.to_string()).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/tasks", axum::routing::get(get_tasks))
        .route("/tasks/:id", axum::routing::get(get_task))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port)
}

fn write_task(ns: &str, id: &str, title: &str, status: &str, context_id: Option<&str>, ts: u64) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    let payload = serde_json::json!({
        "@type": "Task",
        "@id": id,
        "title": title,
        "status": status,
        "context_id": context_id,
        "created_at_ns": ts,
        "updated_at_ns": ts,
    })
    .to_string();
    storage.store_node(id, "Task", None, &payload, None).unwrap();
}

fn write_task_event(ns: &str, id: &str, task_id: &str, event: &str) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    let payload = serde_json::json!({
        "@type": "TaskEvent",
        "@id": id,
        "task_id": task_id,
        "event": event,
        "timestamp_ns": 1_000u64,
    })
    .to_string();
    storage.store_node(id, "TaskEvent", None, &payload, None).unwrap();
}

#[tokio::test]
async fn sidecar_tasks_empty_returns_empty_list() {
    let ns = storage_path();
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body["tasks"].as_array().unwrap().len(), 0);
    assert_eq!(body["total"].as_u64().unwrap(), 0);
}

#[tokio::test]
async fn sidecar_tasks_returns_tasks_newest_first() {
    let ns = storage_path();
    write_task(&ns, "urn:task:t1", "First task", "done", None, 1_000);
    write_task(&ns, "urn:task:t2", "Second task", "done", None, 2_000);
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0]["@id"].as_str().unwrap(), "urn:task:t2", "newest first");
    assert_eq!(tasks[1]["@id"].as_str().unwrap(), "urn:task:t1");
}

#[tokio::test]
async fn sidecar_tasks_status_filter() {
    let ns = storage_path();
    write_task(&ns, "urn:task:done1", "Done task", "done", None, 1_000);
    write_task(&ns, "urn:task:active1", "Active task", "active", None, 2_000);
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value =
        reqwest::get(format!("{}/tasks?status=done", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["status"].as_str().unwrap(), "done");
}

#[tokio::test]
async fn sidecar_get_task_not_found_returns_404() {
    let ns = storage_path();
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let resp = reqwest::get(format!("{}/tasks/nonexistent", base(port)))
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn sidecar_get_task_returns_task_with_events() {
    let ns = storage_path();
    let tid = "urn:refarm:task:v1:abc";
    write_task(&ns, tid, "Test task", "done", None, 1_000);
    write_task_event(&ns, "urn:refarm:task-event:v1:ev1", tid, "created");
    write_task_event(&ns, "urn:refarm:task-event:v1:ev2", tid, "status_changed");
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks/{tid}", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body["task"]["@id"].as_str().unwrap(), tid);
    assert_eq!(body["task"]["title"].as_str().unwrap(), "Test task");
    let events = body["events"].as_array().unwrap();
    assert_eq!(events.len(), 2, "both task events must be returned");
    let event_names: Vec<&str> = events.iter().map(|e| e["event"].as_str().unwrap()).collect();
    assert!(event_names.contains(&"created"));
    assert!(event_names.contains(&"status_changed"));
}
