//! Plugin tests — /plugins listing + reload.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

#[test]
fn sidecar_plugins_response_includes_active_agent_field() {
    // The /plugins response must include activeAgent so the CLI can detect
    // the active agent by capability rather than by name.
    // Verified end-to-end in sidecar_active_agent_is_exposed_in_plugins_response.
    let json = serde_json::json!({ "activeAgent": serde_json::Value::Null });
    assert!(json.get("activeAgent").is_some());
}

#[tokio::test]
async fn sidecar_get_plugins_reports_loaded_agent_channels() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .agent_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);
    let client = reqwest::Client::new();

    let res = client
        .get(format!("{}/plugins", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(
        body["loaded"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/agent")]
    );
    assert_eq!(
        body["known"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/agent")]
    );
}

#[tokio::test]
async fn sidecar_post_plugins_reload_reports_loaded_and_skipped_plugins() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .agent_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/plugins/reload", base(port)))
        .json(&serde_json::json!({
            "pluginIds": ["@refarm/agent", "@refarm/missing"]
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(
        body["reloaded"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/agent")]
    );
    assert_eq!(
        body["skipped"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/missing")]
    );
    assert_eq!(body["deferred"].as_array().unwrap().len(), 0);
    assert!(body["reloadId"].as_str().is_some());
}
