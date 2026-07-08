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
        "RefarmConfig",
        serde_json::json!({
            "@id": "urn:config:one",
            "@type": "RefarmConfig",
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
    assert_eq!(node["@type"].as_str().unwrap(), "RefarmConfig");
    assert_eq!(
        node["runtime"]["sidecarUrl"].as_str().unwrap(),
        "http://127.0.0.1:42001",
    );
}

#[tokio::test]
async fn sidecar_query_nodes_filters_by_type_and_limit() {
    let ns = storage_path();
    write_node(
        &ns,
        "urn:config:one",
        "RefarmConfig",
        serde_json::json!({ "@id": "urn:config:one", "@type": "RefarmConfig" }),
    );
    write_node(
        &ns,
        "urn:config:two",
        "RefarmConfig",
        serde_json::json!({ "@id": "urn:config:two", "@type": "RefarmConfig" }),
    );
    write_node(
        &ns,
        "urn:task:one",
        "Task",
        serde_json::json!({ "@id": "urn:task:one", "@type": "Task" }),
    );
    let (_state, port) = start_nodes_sidecar(&ns).await;

    let body: serde_json::Value =
        reqwest::get(format!("{}/nodes?type=RefarmConfig&limit=1", base(port)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

    let nodes = body["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0]["@type"].as_str().unwrap(), "RefarmConfig");
    assert_eq!(body["total"].as_u64().unwrap(), 1);
}
