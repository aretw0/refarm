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
    assert!(args.profile.is_none(), "profile absent when not supplied");
}

#[test]
fn sidecar_extract_task_args_passes_through_routing_profile() {
    // ADR-012: the host forwards a routing profile verbatim to the responder — it is a
    // neutral field, not host-interpreted, so the guest can resolve the route by intent.
    let args = extract_task_args(&test_task(serde_json::json!({
        "prompt": "ping",
        "profile": "  cheap  "
    })))
    .expect("prompt+profile args must parse");
    assert_eq!(args.profile.as_deref(), Some("cheap"));
    // A blank profile is treated as absent (same rule as provider/model).
    let blank = extract_task_args(&test_task(serde_json::json!({
        "prompt": "ping",
        "profile": "   "
    })))
    .expect("blank profile still parses");
    assert!(blank.profile.is_none());
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

    let state = SidecarState::for_test(&tmp, namespace).unwrap();

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
    // `total` is GONE, not renamed. It was computed after the truncate, so it always equalled
    // the page size — a consumer reading it to ask "is there more" got "no", always. A key
    // whose meaning changes silently is worse than one that vanishes loudly (ISS-041).
    assert!(body.get("total").is_none(), "total was removed, not redefined");
    // The empty answer now says WHICH empty it is: nothing stored, and nothing withheld.
    assert_eq!(body["stored"].as_u64().unwrap(), 0);
    assert_eq!(body["truncated"].as_bool().unwrap(), false);
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
    let tid = "urn:sovereign:task:v1:abc";
    write_task(&ns, tid, "Test task", "done", None, 1_000);
    write_task_event(&ns, "urn:sovereign:task-event:v1:ev1", tid, "created");
    write_task_event(&ns, "urn:sovereign:task-event:v1:ev2", tid, "status_changed");
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

#[tokio::test]
async fn sidecar_tasks_limit_is_taken_in_the_same_order_it_is_presented() {
    // BE PRECISE ABOUT WHAT THIS PINS. The code replaced here would pass it: it read every row,
    // sorted the WHOLE set by `created_at_ns`, and only then truncated — correct order at
    // unbounded cost. What this guards is the naive fix, the one a future editor reaches for
    // first: move the limit into SQL and leave the Rust re-sort behind it. That takes the page
    // by the store's order (`updated_at DESC, id DESC`) and presents it by another, which
    // answers neither question.
    //
    // The two keys disagree here on purpose — `t_old` is written LAST, so it is the newest by
    // updated_at and the oldest by created_at. Under the naive fix, `?limit=1` returns `t_old`
    // and calls it the newest.
    let ns = storage_path();
    write_task(&ns, "urn:task:t_new", "Newest by created_at", "done", None, 9_000);
    write_task(&ns, "urn:task:t_old", "Oldest by created_at", "done", None, 1_000);
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks?limit=1", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(
        tasks[0]["@id"].as_str().unwrap(),
        "urn:task:t_new",
        "the ONE row a limit of 1 returns must be the one the presented order calls first"
    );
    assert_eq!(body["stored"].as_u64().unwrap(), 2, "stored counts what exists, not the page");
    assert_eq!(body["truncated"].as_bool().unwrap(), true);
}

#[tokio::test]
async fn sidecar_tasks_filter_is_applied_before_the_limit_not_after() {
    // ISS-045's shape, guarded on the endpoint that would have grown it: three `active` tasks
    // are newer than the only `done` one, so a limit applied to the UNFILTERED set and then
    // filtered would return an empty list and report the record as complete.
    let ns = storage_path();
    write_task(&ns, "urn:task:d1", "The done one", "done", None, 1_000);
    write_task(&ns, "urn:task:a1", "Active", "active", None, 2_000);
    write_task(&ns, "urn:task:a2", "Active", "active", None, 3_000);
    write_task(&ns, "urn:task:a3", "Active", "active", None, 4_000);
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/tasks?status=done&limit=1", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "the done task is reachable even though three newer ones are not done");
    assert_eq!(tasks[0]["@id"].as_str().unwrap(), "urn:task:d1");
    assert_eq!(
        body["stored"].as_u64().unwrap(),
        1,
        "stored counts what MATCHES the filter — a count over all four would make truncated lie"
    );
    assert_eq!(body["truncated"].as_bool().unwrap(), false);
}

#[tokio::test]
async fn sidecar_tasks_offset_reaches_the_rows_a_page_left_behind() {
    let ns = storage_path();
    write_task(&ns, "urn:task:p1", "First", "done", None, 3_000);
    write_task(&ns, "urn:task:p2", "Second", "done", None, 2_000);
    write_task(&ns, "urn:task:p3", "Third", "done", None, 1_000);
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let page_two: serde_json::Value =
        reqwest::get(format!("{}/tasks?limit=2&offset=2", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    let tasks = page_two["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["@id"].as_str().unwrap(), "urn:task:p3");
    assert_eq!(page_two["offset"].as_u64().unwrap(), 2);
    // The last page is NOT truncated: rows before the offset were skipped on purpose and are
    // reachable by asking again, so "is there more" means more BEYOND this page.
    assert_eq!(
        page_two["truncated"].as_bool().unwrap(),
        false,
        "stored(3) > nodes(1) is true and yet nothing remains — offset must count as delivered"
    );
}

#[tokio::test]
async fn sidecar_tasks_session_filter_and_malformed_payload_are_both_excluded_consistently() {
    let ns = storage_path();
    write_task(&ns, "urn:task:s1", "Mine", "done", Some("urn:session:a"), 2_000);
    write_task(&ns, "urn:task:s2", "Theirs", "done", Some("urn:session:b"), 1_000);
    // A row whose payload is not JSON. The Rust code this replaces dropped such rows silently
    // via `from_str(..).ok()`; the SQL `json_valid` guard must drop it from BOTH the page and
    // the count, or `truncated` would claim a row exists that the endpoint can never return.
    crate::storage::NativeStorage::open(&ns)
        .unwrap()
        .store_node("urn:task:broken", "Task", None, "not json at all", None)
        .unwrap();
    let (_state, port) = start_tasks_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!(
        "{}/tasks?session_id=urn%3Asession%3Aa",
        base(port)
    ))
    .await
    .unwrap()
    .json()
    .await
    .unwrap();

    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["@id"].as_str().unwrap(), "urn:task:s1");
    assert_eq!(body["stored"].as_u64().unwrap(), 1);
    assert_eq!(body["truncated"].as_bool().unwrap(), false);
}
