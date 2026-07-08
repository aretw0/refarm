//! Provider-liveness endpoint tests — the read-only reachability probe.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! No real LLM, no WASM: a local stub axum server plays the "provider" so the
//! probe's verdict mapping is deterministic and offline.

use super::*;
use crate::test_support::env_lock;

/// Mount just the liveness route on a fresh port — the handler needs no state.
async fn start_liveness_sidecar() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = axum::Router::new().route(
        "/providers/liveness",
        axum::routing::get(get_provider_liveness),
    );
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    port
}

#[tokio::test]
async fn liveness_requires_a_provider_param() {
    let port = start_liveness_sidecar().await;
    let resp = reqwest::get(format!("{}/providers/liveness", base(port)))
        .await
        .unwrap();
    assert_eq!(resp.status(), 400, "missing provider → 400");
}

#[tokio::test]
async fn liveness_reports_unreachable_when_the_endpoint_refuses() {
    // "ollama" resolves to the localhost floor (127.0.0.1:11434). Bind that port
    // to nothing is not reliable, so instead probe a provider whose resolved URL
    // points at a closed port: use MODEL_BASE_URL to force an unroutable target.
    // A connection error must map to unreachable, never a false "up".
    let _env = env_lock();
    let previous = std::env::var("MODEL_BASE_URL").ok();
    // 127.0.0.1:1 is the discard-ish low port — connection refused fast.
    std::env::set_var("MODEL_BASE_URL", "http://127.0.0.1:1");
    let port = start_liveness_sidecar().await;
    let body: serde_json::Value =
        reqwest::get(format!("{}/providers/liveness?provider=groq", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    match previous {
        Some(v) => std::env::set_var("MODEL_BASE_URL", v),
        None => std::env::remove_var("MODEL_BASE_URL"),
    }

    assert_eq!(body["provider"], "groq");
    assert_eq!(body["reachable"], false);
    assert_eq!(body["reason"], "unreachable");
}

#[tokio::test]
async fn liveness_reports_reachable_against_a_stub_that_answers_200() {
    // Stand up a local stub that answers 200, point MODEL_BASE_URL at it, and
    // confirm the probe reads "up".
    let stub = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let stub_port = stub.local_addr().unwrap().port();
    let stub_router = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
    tokio::spawn(async move {
        axum::serve(stub, stub_router).await.unwrap();
    });

    let _env = env_lock();
    let previous = std::env::var("MODEL_BASE_URL").ok();
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{stub_port}"));
    let port = start_liveness_sidecar().await;
    let body: serde_json::Value =
        reqwest::get(format!("{}/providers/liveness?provider=groq", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    match previous {
        Some(v) => std::env::set_var("MODEL_BASE_URL", v),
        None => std::env::remove_var("MODEL_BASE_URL"),
    }

    assert_eq!(body["reachable"], true);
    assert_eq!(body["reason"], "reachable");
    assert_eq!(body["status"], 200);
}

#[tokio::test]
async fn liveness_maps_401_to_auth_failed_endpoint_is_up() {
    // A stub that answers 401 proves the endpoint is up but rejects the
    // unauthenticated GET → auth-failed, reachable:true (a milder, accurate
    // verdict than "down"), and the host never sends a key.
    let stub = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let stub_port = stub.local_addr().unwrap().port();
    let stub_router = axum::Router::new().route(
        "/",
        axum::routing::get(|| async { (axum::http::StatusCode::UNAUTHORIZED, "no") }),
    );
    tokio::spawn(async move {
        axum::serve(stub, stub_router).await.unwrap();
    });

    let _env = env_lock();
    let previous = std::env::var("MODEL_BASE_URL").ok();
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{stub_port}"));
    let port = start_liveness_sidecar().await;
    let body: serde_json::Value =
        reqwest::get(format!("{}/providers/liveness?provider=groq", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    match previous {
        Some(v) => std::env::set_var("MODEL_BASE_URL", v),
        None => std::env::remove_var("MODEL_BASE_URL"),
    }

    assert_eq!(body["reachable"], true, "401 means the endpoint answered");
    assert_eq!(body["reason"], "auth-failed");
    assert_eq!(body["status"], 401);
}
