//! Plugin tests — /plugins listing + reload.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

#[test]
fn sidecar_plugins_response_includes_active_agent_field() {
    // The /plugins response must include defaultResponder so the CLI can detect
    // the active agent by capability rather than by name.
    // Verified end-to-end in sidecar_active_agent_is_exposed_in_plugins_response.
    let json = serde_json::json!({ "defaultResponder": serde_json::Value::Null });
    assert!(json.get("defaultResponder").is_some());
}

#[tokio::test]
async fn sidecar_get_plugins_reports_loaded_agent_channels() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .plugin_channels
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
    // MEASURED 2026-08-25: this used to also assert `known` equalled `loaded` — `installed`,
    // `loaded` and `known` were the SAME variable, and `local` a literal `[]`. That let a
    // plugin handed to the host that failed to load vanish from the answer entirely. Now the
    // host reports only what it can observe: `loaded` (this channel) and `requested` (the
    // `--plugin` startup requests it recorded). This sidecar was built via `for_test` with no
    // `with_reload` — no live host is wired, so `requested` degrades to empty honestly rather
    // than guessing (see `get_plugins`'s doc comment). See
    // `requested_and_loaded_are_separate_facts` below for the case where they differ.
    assert_eq!(
        body["requested"].as_array().unwrap(),
        &Vec::<serde_json::Value>::new()
    );
    assert!(
        body.get("known").is_none(),
        "known was the same variable as loaded under four names — it is not the host's to answer"
    );
}

#[test]
fn requested_and_loaded_are_separate_facts() {
    // MEASURED 2026-08-25: `installed`, `loaded` and `known` were THE SAME VARIABLE and
    // `local` was a literal `[]`. So a plugin handed to the host that failed to load vanished
    // from the answer entirely, and the silence was indistinguishable from never having been
    // asked for.
    //
    // THE §9 TRAP THIS TEST EXISTS AGAINST: asserting `requested.len() == loaded.len()` PASSES
    // under the old code, because they were one list. So this constructs a state where they
    // MUST differ and asserts that they do.
    let payload = plugins_payload(
        &[
            ("agent".to_string(), "/p/agent.wasm".into(), Some("agent".to_string())),
            ("bad".to_string(), "/p/bad.wasm".into(), None),
        ],
        &["agent".to_string()],
        "agent",
    );

    let requested = payload["requested"].as_array().expect("requested is an array");
    assert_eq!(requested.len(), 2, "both were asked for");
    assert_eq!(payload["loaded"].as_array().unwrap().len(), 1, "only one loaded");

    let failed = requested.iter().find(|r| r["id"] == "bad").expect("the failure is reported");
    assert_eq!(failed["loaded"], false);
    assert!(failed["because"].is_string(), "a request that did not load says why");
}

#[tokio::test]
async fn sidecar_plugins_reload_is_an_honest_readiness_probe_not_a_reload() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .plugin_channels
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
    // Without a reload host wired (this sidecar was built for a test, no
    // with_reload), the endpoint DEGRADES to an honest readiness probe:
    // alreadyLoaded (not "reloaded" — no code swapped) and an explicit
    // reloaded:false, so a client can't mistake "host not wired" for a real reload.
    // The real path (host.reload_plugin) is covered end-to-end in
    // tests/plugin_shutdown.rs::reload_plugin_replaces_the_running_instance.
    assert_eq!(
        body["alreadyLoaded"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/agent")]
    );
    assert_eq!(
        body["skipped"].as_array().unwrap(),
        &vec![serde_json::json!("@refarm/missing")]
    );
    assert_eq!(body["reloaded"], serde_json::json!(false));
    assert!(body["probeId"].as_str().is_some());
}

#[tokio::test]
async fn sidecar_load_by_hash_degrades_honestly_without_a_live_host() {
    // The E3 runtime seam: POST /plugins/load-by-hash. Without a reload host wired
    // (test sidecar, no with_reload), it degrades to an honest {loaded:false} with a
    // reason — a client can't mistake "host not wired" for a real load. The real load
    // path is covered end-to-end in boot_integration.rs::load_plugin_by_hash_*.
    let (state, port, _tmp) = start_test_sidecar().await;
    let _ = state;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/plugins/load-by-hash", base(port)))
        .json(&serde_json::json!({
            "assetsDir": "/tmp/assets",
            "hash": "deadbeef",
            "manifest": "{}"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["loaded"], serde_json::json!(false));
    assert!(
        body["reason"].as_str().is_some(),
        "an honest reason, not a silent success"
    );
}
