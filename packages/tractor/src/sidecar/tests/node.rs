//! Generic node read tests — sidecar graph read surface.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

async fn start_nodes_sidecar(namespace: &str) -> (SidecarState, u16) {
    let tmp = std::env::temp_dir().join(format!("tractor-nodes-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    let state = SidecarState::for_test(&tmp, namespace).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/nodes", axum::routing::get(get_nodes))
        .route("/nodes/:id", axum::routing::get(get_node_by_id))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port)
}

fn write_node(ns: &str, id: &str, type_: &str, payload: serde_json::Value) {
    let storage = crate::storage::NativeStorage::open(ns).unwrap();
    storage
        .store_node(id, type_, None, &payload.to_string(), None)
        .unwrap();
}

#[tokio::test]
async fn sidecar_get_node_returns_graph_node() {
    let ns = storage_path();
    write_node(
        &ns,
        "urn:config:one",
        "SovereignConfig",
        serde_json::json!({
            "@id": "urn:config:one",
            "@type": "SovereignConfig",
            "runtime": { "sidecarUrl": "http://127.0.0.1:42001" },
        }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/nodes/urn:config:one", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let node = &body["node"];
    assert_eq!(node["@id"].as_str().unwrap(), "urn:config:one");
    assert_eq!(node["@type"].as_str().unwrap(), "SovereignConfig");
    assert_eq!(
        node["runtime"]["sidecarUrl"].as_str().unwrap(),
        "http://127.0.0.1:42001",
    );
}

#[tokio::test]
async fn sidecar_get_node_stamps_default_context_when_absent() {
    // Every store_node call site in this Rust host passes context: None today
    // (grep '@context' packages/tractor/src returns nothing) — this is the
    // realistic shape of a node this host itself wrote: no `@context` in the
    // stored payload and no `context` column value either.
    let ns = storage_path();
    write_node(
        &ns,
        "urn:tractor:budget-observation:one",
        "BudgetObservation",
        serde_json::json!({
            "@id": "urn:tractor:budget-observation:one",
            "@type": "BudgetObservation",
            "refarm.outcome": "done",
        }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!(
        "{}/nodes/urn:tractor:budget-observation:one",
        base(port)
    ))
    .await
    .unwrap()
    .json()
    .await
    .unwrap();

    let node = &body["node"];
    assert_eq!(
        node["@context"].as_str().unwrap(),
        "urn:sovereign:schema:v1",
        "a node with no @context anywhere (payload or context column) must be \
         stamped with the sovereign-runtime default at the serving boundary",
    );
}

#[tokio::test]
async fn sidecar_get_node_preserves_existing_context() {
    // A node replicated in from a TS producer (or any writer) that already
    // embedded @context directly in its JSON payload must keep that value —
    // the serving boundary must never clobber a producer's own choice.
    let ns = storage_path();
    write_node(
        &ns,
        "urn:test:help-page",
        "HelpPage",
        serde_json::json!({
            "@id": "urn:test:help-page",
            "@type": "HelpPage",
            "@context": "https://schema.org/",
        }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/nodes/urn:test:help-page", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let node = &body["node"];
    assert_eq!(
        node["@context"].as_str().unwrap(),
        "https://schema.org/",
        "an already-present @context in the stored payload must win over the default",
    );
}

#[tokio::test]
async fn sidecar_query_nodes_stamps_context_on_every_row() {
    // GET /nodes (queryNodes) must apply the same stamping as GET /nodes/:id
    // (getNode) — both route through node_value_from_row, but this pins that
    // the list endpoint is not a second, divergent code path.
    let ns = storage_path();
    write_node(
        &ns,
        "urn:tractor:session:one",
        "Session",
        serde_json::json!({ "@id": "urn:tractor:session:one", "@type": "Session" }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/nodes?type=Session&limit=10", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let nodes = body["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(
        nodes[0]["@context"].as_str().unwrap(),
        "urn:sovereign:schema:v1",
    );
}

#[tokio::test]
async fn sidecar_query_nodes_filters_by_type_and_limit() {
    let ns = storage_path();
    write_node(
        &ns,
        "urn:config:one",
        "SovereignConfig",
        serde_json::json!({ "@id": "urn:config:one", "@type": "SovereignConfig" }),
    );
    write_node(
        &ns,
        "urn:config:two",
        "SovereignConfig",
        serde_json::json!({ "@id": "urn:config:two", "@type": "SovereignConfig" }),
    );
    write_node(
        &ns,
        "urn:task:one",
        "Task",
        serde_json::json!({ "@id": "urn:task:one", "@type": "Task" }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value =
        reqwest::get(format!("{}/nodes?type=SovereignConfig&limit=1", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    let nodes = body["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0]["@type"].as_str().unwrap(), "SovereignConfig");
    assert_eq!(body["total"].as_u64().unwrap(), 1);
}

#[tokio::test]
async fn sidecar_query_nodes_reports_truncation_when_limit_undercounts_storage() {
    // 5 stored, limit=2: the ceiling bites, and the response must say so — both HOW MANY
    // exist (`stored`) and THAT the page is incomplete (`truncated`). `total` keeps meaning
    // "rows in THIS response" (pinned by `sidecar_query_nodes_filters_by_type_and_limit`
    // above) — it must NOT silently become the store-wide count, which would collide with
    // `apps/refarm/src/commands/budget.ts`'s own `summary.total` (== observations returned).
    let ns = storage_path();
    for i in 0..5 {
        write_node(
            &ns,
            &format!("urn:task:{i}"),
            "Task",
            serde_json::json!({ "@id": format!("urn:task:{i}"), "@type": "Task" }),
        );
    }
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/nodes?type=Task&limit=2", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let nodes = body["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 2, "limit=2 must still cap the response body");
    assert_eq!(
        body["total"].as_u64().unwrap(),
        2,
        "total must stay 'how many rows are in this response', unchanged by this fix"
    );
    assert_eq!(
        body["stored"].as_u64().unwrap(),
        5,
        "stored must name the real count across the whole type, not the capped page"
    );
    assert_eq!(
        body["truncated"].as_bool().unwrap(),
        true,
        "5 stored > 2 returned: this response is not the whole answer, and must say so"
    );
}

#[tokio::test]
async fn sidecar_query_nodes_reports_no_truncation_when_limit_covers_everything() {
    let ns = storage_path();
    for i in 0..3 {
        write_node(
            &ns,
            &format!("urn:task:{i}"),
            "Task",
            serde_json::json!({ "@id": format!("urn:task:{i}"), "@type": "Task" }),
        );
    }
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value = reqwest::get(format!("{}/nodes?type=Task&limit=10", base(port)))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let nodes = body["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 3);
    assert_eq!(body["stored"].as_u64().unwrap(), 3);
    assert_eq!(
        body["truncated"].as_bool().unwrap(),
        false,
        "limit=10 covers all 3 stored rows: nothing was left out, so truncated must be false"
    );
}
