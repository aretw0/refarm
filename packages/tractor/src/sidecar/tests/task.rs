//! Task tests — extract_task_args parsing + /tasks endpoints.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

#[test]
fn sidecar_extract_task_args_accepts_prompt() {
    let args = extract_task_args(&test_task(serde_json::json!({
        "prompt": "ping",
        "system": "sys",
        "session_id": "session-a",
        "history_turns": 4,
        "provider": " openai-codex ",
        "model": " gpt-5.3-codex-spark "
    })))
    .expect("prompt args must parse");

    assert_eq!(args.prompt, "ping");
    assert_eq!(args.system.as_deref(), Some("sys"));
    assert_eq!(args.session_id.as_deref(), Some("session-a"));
    assert_eq!(args.history_turns, Some(4));
    assert_eq!(args.provider.as_deref(), Some("openai-codex"));
    assert_eq!(args.model.as_deref(), Some("gpt-5.3-codex-spark"));
}

#[test]
fn sidecar_extract_task_args_accepts_legacy_query() {
    let args = extract_task_args(&test_task(serde_json::json!({ "query": "ping" })))
        .expect("legacy query args must parse");

    assert_eq!(args.prompt, "ping");
}

#[test]
fn sidecar_extract_task_args_rejects_missing_prompt() {
    let error =
        extract_task_args(&test_task(serde_json::json!({}))).expect_err("missing prompt must fail");

    assert!(error.contains("requires args.prompt"));
}

async fn start_tasks_sidecar(namespace: &str) -> (SidecarState, u16) {
    let tmp = std::env::temp_dir().join(format!("tractor-tasks-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(
        channels,
        Arc::new(RwLock::new(None)),
        crate::EventRouter::default(),
        crate::TelemetryBus::new(100),
        &tmp,
        namespace.to_string(),
    )
    .unwrap();

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
    storage
        .store_node(id, "Task", None, &payload, None)
        .unwrap();
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
    storage
        .store_node(id, "TaskEvent", None, &payload, None)
        .unwrap();
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
    assert_eq!(
        tasks[0]["@id"].as_str().unwrap(),
        "urn:task:t2",
        "newest first"
    );
    assert_eq!(tasks[1]["@id"].as_str().unwrap(), "urn:task:t1");
}

#[tokio::test]
async fn sidecar_tasks_status_filter() {
    let ns = storage_path();
    write_task(&ns, "urn:task:done1", "Done task", "done", None, 1_000);
    write_task(
        &ns,
        "urn:task:active1",
        "Active task",
        "active",
        None,
        2_000,
    );
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks?status=done", base(port)))
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
    let event_names: Vec<&str> = events
        .iter()
        .map(|e| e["event"].as_str().unwrap())
        .collect();
    assert!(event_names.contains(&"created"));
    assert!(event_names.contains(&"status_changed"));
}
