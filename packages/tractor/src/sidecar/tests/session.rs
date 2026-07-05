//! Session tests — history, fork, create.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

async fn start_history_sidecar(namespace: &str) -> (SidecarState, u16) {
    let tmp = std::env::temp_dir().join(format!("tractor-hist-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
    let state = SidecarState::new(
        channels,
        Arc::new(RwLock::new(HashMap::new())), // cancel_flags
        Arc::new(RwLock::new(HashMap::new())), // in_flight_cancels
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
        .route(
            "/sessions",
            axum::routing::post(post_session_new).get(get_sessions),
        )
        .route("/sessions/:id/fork", axum::routing::post(post_session_fork))
        .route(
            "/sessions/:id/history",
            axum::routing::get(get_session_history),
        )
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
    storage
        .store_node(id, "Session", None, &payload, None)
        .unwrap();
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
    storage
        .store_node(id, "SessionEntry", None, &payload, None)
        .unwrap();
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

    let body: serde_json::Value = reqwest::get(format!("{}/sessions/{}/history", base(port), sid))
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

    assert_eq!(
        resp.status(),
        200,
        "prefix should resolve to unique session"
    );
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
    assert_eq!(
        fork["leaf_entry_id"].as_str().unwrap(),
        e1,
        "inherits leaf from parent"
    );
    assert_eq!(fork["name"].as_str().unwrap(), "test-fork");
    assert!(fork["@id"]
        .as_str()
        .unwrap()
        .starts_with("urn:refarm:session:v1:"));
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
    assert!(session["@id"]
        .as_str()
        .unwrap()
        .starts_with("urn:refarm:session:v1:"));
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
