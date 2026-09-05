//! Connection control-plane tests — GET /connections, POST /connections/:name/up,
//! POST /connections/:name/down. Body-only child of `sidecar::tests` (see the
//! `#[path]` decls in tests.rs). `use super::*;` pulls the shared helpers + every
//! sidecar item the parent glob-imports.
//!
//! These are the ONLY sidecar tests that boot a real `TractorNative` (`with_reload`):
//! the operator methods under test (`PluginHost::list_declared_connections` /
//! `ensure_connection_as_operator` / `stop_connection_as_operator`) live on
//! `TractorNative::plugins`, which the sidecar reaches only via `state.reload`. The
//! cheaper unit-level coverage of those same methods (bare `PluginHost::new()`, no
//! boot) lives in `host/plugin_host_tests/connection_ops.rs`; this file exists
//! specifically to prove the HTTP wiring — routes, JSON shapes, status codes — and,
//! per the task, to prove the sharing guarantee "now at the HTTP layer".

use super::*;
use crate::test_support::DeclaredBaseGuard;


fn ensure_sovereign_dir_env() {
    use std::sync::Once;
    static SET: Once = Once::new();
    SET.call_once(|| std::env::set_var("SOVEREIGN_DIR", ".refarm"));
}

fn write_connections_config(dir: &std::path::Path, connections_json: &str) {
    let refarm_dir = dir.join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(
        refarm_dir.join("config.json"),
        format!(r#"{{"connections":{connections_json}}}"#),
    )
    .unwrap();
}

/// A declaration that reaches `Ready` on the first probe poll — the REAL adapters
/// (`spawn_establish_process` / `run_probe`), exercised end to end through the HTTP
/// layer this time.
fn trivial_connection_json() -> &'static str {
    r#"{ "c": { "establish": ["true"], "probe": { "run": ["true"] }, "probeIntervalMs": 1, "readyTimeoutMs": 5000 } }"#
}

async fn start_connections_sidecar() -> (SidecarState, u16, std::sync::Arc<crate::TractorNative>) {
    let tmp = std::env::temp_dir().join(format!("tractor-connections-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let tractor = crate::TractorNative::boot(crate::TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: crate::SecurityMode::None,
        ..Default::default()
    })
    .await
    .expect("boot tractor");
    let tractor = std::sync::Arc::new(tractor);

    let state = SidecarState::for_test(&tmp, ":memory:").unwrap().with_reload(tractor.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/connections", axum::routing::get(get_connections))
        .route("/connections/:name/up", axum::routing::post(post_connection_up))
        .route("/connections/:name/down", axum::routing::post(post_connection_down))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port, tractor)
}

#[tokio::test]
async fn sidecar_get_connections_reports_a_never_established_name_as_down() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let (_state, port, tractor) = start_connections_sidecar().await;
    let client = reqwest::Client::new();

    let res = client.get(format!("{}/connections", base(port))).send().await.unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    let connections = body["connections"].as_array().unwrap();
    assert_eq!(connections.len(), 1, "the declared-but-never-established connection must be LISTED");
    assert_eq!(connections[0]["name"], "c");
    assert_eq!(connections[0]["status"], "down", "never established ⇒ down, never omitted");
    assert_eq!(connections[0]["claims"], 0);
    assert!(connections[0]["sinceNs"].is_null());

    tractor.shutdown().await.expect("shutdown must succeed");
}

#[tokio::test]
async fn sidecar_post_connection_up_on_an_undeclared_name_is_a_clean_404() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap(); // no connections declared at all
    let _base = DeclaredBaseGuard::enter(dir.path());

    let (_state, port, tractor) = start_connections_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/connections/ghost/up", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404, "an undeclared name is a clean 404, not a 500");
    let body: serde_json::Value = res.json().await.unwrap();
    let message = body["error"].as_str().unwrap();
    assert!(
        message.contains("ghost") && message.contains("declared"),
        "must name the missing declaration: {message}"
    );

    tractor.shutdown().await.expect("shutdown must succeed");
}

/// The sharing guarantee (D5), proven at the HTTP layer per the task: two `up` calls
/// against the same name must perform exactly ONE establish. `connection_spawn_count`
/// (test-only, `PluginHost`) is what makes this assertion mutation-resistant — without
/// it, two `up` calls both reporting `status: "up"` with DIFFERENT claim ids would look
/// identical whether the underlying engine shared one process or (wrongly) spawned two.
#[tokio::test]
async fn sidecar_up_called_twice_performs_one_establish_and_reports_two_claims() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let (_state, port, tractor) = start_connections_sidecar().await;
    let client = reqwest::Client::new();

    let first = client
        .post(format!("{}/connections/c/up", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200);
    let first_body: serde_json::Value = first.json().await.unwrap();
    assert_eq!(first_body["status"], "up");
    let claim_1 = first_body["claim"].as_u64().expect("first up must mint a claim");

    let second = client
        .post(format!("{}/connections/c/up", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), 200);
    let second_body: serde_json::Value = second.json().await.unwrap();
    assert_eq!(second_body["status"], "up");
    let claim_2 = second_body["claim"].as_u64().expect("second up must mint its own claim");

    assert_ne!(claim_1, claim_2, "each up call gets a distinct claim");
    assert_eq!(second_body["claims"], 2, "the claim-count report: both claims on the one connection");
    assert_eq!(
        tractor.plugins.connection_spawn_count("c"),
        1,
        "up called twice must perform exactly ONE establish — the sharing guarantee, at the HTTP layer"
    );

    // GET reflects the same state a caller would see independently.
    let list = client.get(format!("{}/connections", base(port))).send().await.unwrap();
    let list_body: serde_json::Value = list.json().await.unwrap();
    let entry = &list_body["connections"][0];
    assert_eq!(entry["status"], "up");
    assert_eq!(entry["claims"], 2);
    assert!(entry["sinceNs"].as_u64().is_some(), "an UP connection must report when it came up");

    tractor.shutdown().await.expect("shutdown must succeed");
}

/// The operator stop (item 1 of the task): sovereign even with claims outstanding, but
/// the response REPORTS how many were active (D12) — the claim-count report this test
/// mutation-verifies alongside the sharing test above.
#[tokio::test]
async fn sidecar_down_reports_active_claims_then_is_idempotent() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let (_state, port, tractor) = start_connections_sidecar().await;
    let client = reqwest::Client::new();

    // Two ups ⇒ two outstanding claims, mirroring the sharing test above.
    client.post(format!("{}/connections/c/up", base(port))).send().await.unwrap();
    client.post(format!("{}/connections/c/up", base(port))).send().await.unwrap();

    let down = client
        .post(format!("{}/connections/c/down", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(down.status(), 200);
    let down_body: serde_json::Value = down.json().await.unwrap();
    assert_eq!(down_body["status"], "down");
    assert_eq!(down_body["claims"], 0, "the post-stop state itself is claimless");
    assert_eq!(down_body["claimsActive"], 2, "the report: two claims WERE active at the moment of the stop");

    // Idempotent: stopping an already-down connection is a clean no-op, never an error.
    let down_again = client
        .post(format!("{}/connections/c/down", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(down_again.status(), 200);
    let down_again_body: serde_json::Value = down_again.json().await.unwrap();
    assert_eq!(down_again_body["status"], "down");
    assert_eq!(down_again_body["claimsActive"], 0, "nothing was active on the second stop");

    let undeclared_down = client
        .post(format!("{}/connections/ghost/down", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(undeclared_down.status(), 404, "an undeclared name is a clean 404 on down too");

    tractor.shutdown().await.expect("shutdown must succeed");
}
