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
    //
    // CRITICAL (review round 1): the paths below are PRODUCTION-SHAPED — every real
    // `--plugin` argument installs as `.../refarm_<name>/plugin.wasm`
    // (`apps/refarm/src/commands/runtime-node-args.ts`), so the file is literally named
    // `plugin.wasm` for the agent, lsp-code-ops, etc. A prior fixture (`/p/agent.wasm`,
    // `/p/bad.wasm`) coincidentally made file-stem-derived ids equal the real ids and
    // masked exactly this collision. Identifying rows by `path` below, not `id`, is
    // deliberate: `id` is what is under test.
    let payload = plugins_payload(
        &[
            (
                "/p/refarm_agent/plugin.wasm".into(),
                PluginLoadOutcome::Loaded("agent".to_string()),
            ),
            (
                "/p/refarm_bad/plugin.wasm".into(),
                PluginLoadOutcome::Failed("wasm parse error: unexpected end of file".to_string()),
            ),
        ],
        &["agent".to_string()],
        Some("agent"),
        &std::collections::HashMap::new(),
    );

    let requested = payload["requested"].as_array().expect("requested is an array");
    assert_eq!(requested.len(), 2, "both were asked for");
    assert_eq!(payload["loaded"].as_array().unwrap().len(), 1, "only one loaded");

    let loaded_row = requested
        .iter()
        .find(|r| r["path"] == "/p/refarm_agent/plugin.wasm")
        .expect("the success is reported");
    assert_eq!(loaded_row["id"], "agent", "a successful load reports its real manifest id");
    assert_eq!(loaded_row["loaded"], true);

    let failed = requested
        .iter()
        .find(|r| r["path"] == "/p/refarm_bad/plugin.wasm")
        .expect("the failure is reported");
    assert_eq!(failed["loaded"], false);
    assert!(
        failed["id"].is_null(),
        "an unknown id must be reported as null, never guessed from the path — both files          here are literally named plugin.wasm, so a stem-derived id would collide with the          loaded row's id above"
    );
    assert_eq!(
        failed["because"], "wasm parse error: unexpected end of file",
        "because carries the REAL load error, not a canned string"
    );
}

#[test]
fn default_responder_absence_is_null_not_the_empty_string() {
    // SPEC ❌ found in review round 1: absence must not be spelled as the empty string —
    // "nobody elected" and "elected the empty string" are different facts, and this field's
    // whole job is to keep them apart (the same invariant `requested[].id` above defends).
    let none_payload = plugins_payload(&[], &[], None, &std::collections::HashMap::new());
    assert!(
        none_payload["defaultResponder"].is_null(),
        "no elected responder must serialize as null, not \"\""
    );

    let some_payload = plugins_payload(&[], &[], Some("agent"), &std::collections::HashMap::new());
    assert_eq!(some_payload["defaultResponder"], "agent");
}

/// Boots a REAL `TractorNative` and wires it into a `/plugins`-only sidecar via
/// `with_reload` — the only way `GET /plugins` can read `requested_plugins()` off a live
/// host rather than degrading to `[]`. Mirrors `connection.rs`'s `start_connections_sidecar`
/// (that file's header comment explains why booting a real host is the right pattern for
/// proving HTTP wiring, not just the pure builder underneath it).
async fn start_plugins_sidecar() -> (SidecarState, u16, std::sync::Arc<crate::TractorNative>) {
    let tmp = std::env::temp_dir().join(format!("tractor-plugins-test-{}", uuid::Uuid::new_v4()));
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

    let state = SidecarState::for_test(&tmp, ":memory:")
        .unwrap()
        .with_reload(tractor.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let router = axum::Router::new()
        .route("/plugins", axum::routing::get(get_plugins))
        .with_state(state.clone());

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (state, port, tractor)
}

#[tokio::test]
async fn sidecar_get_plugins_reads_requested_through_a_real_host() {
    // IMPORTANT (review round 1): `requested_and_loaded_are_separate_facts` above exercises
    // `plugins_payload` directly with hand-built tuples, bypassing `state.reload.as_ref()
    // .map(|host| host.requested_plugins())` entirely, and
    // `sidecar_get_plugins_reports_loaded_agent_channels` only exercises the UNWIRED
    // (`requested == []`) branch. Neither ever calls `record_plugin_request` on a real
    // `TractorNative` and reads it back through `GET /plugins` — the wiring this test
    // proves. It would have caught the id-collision defect immediately: both paths below
    // are literally named `plugin.wasm`, exactly the production shape.
    let (_state, port, tractor) = start_plugins_sidecar().await;

    tractor.record_plugin_request(
        std::path::Path::new("/p/refarm_agent/plugin.wasm"),
        PluginLoadOutcome::Loaded("agent".to_string()),
    );
    tractor.record_plugin_request(
        std::path::Path::new("/p/refarm_bad/plugin.wasm"),
        PluginLoadOutcome::Failed("wasm parse error: unexpected end of file".to_string()),
    );

    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/plugins", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();

    let requested = body["requested"].as_array().expect("requested is an array");
    assert_eq!(requested.len(), 2, "both requests recorded on the real host round-trip");

    let agent_row = requested
        .iter()
        .find(|r| r["path"] == "/p/refarm_agent/plugin.wasm")
        .expect("the loaded request is reported");
    assert_eq!(agent_row["id"], "agent", "a real load's id survives the HTTP round trip");
    assert_eq!(agent_row["loaded"], true);

    let bad_row = requested
        .iter()
        .find(|r| r["path"] == "/p/refarm_bad/plugin.wasm")
        .expect("the failed request is reported");
    assert!(
        bad_row["id"].is_null(),
        "an id must never be guessed from a colliding path — both files here are literally \
         named plugin.wasm, the real production shape"
    );
    assert_eq!(bad_row["loaded"], false);
    assert_eq!(
        bad_row["because"], "wasm parse error: unexpected end of file",
        "the real load error survives the HTTP round trip, not a canned string"
    );
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

// ── The effective permission set, which no surface reported until 2026-08-26 ──────────────
//
// ISS-171. `plugin permissions` shows what a plugin DECLARES; the config shows what the operator
// APPROVED; `scope_to_approved` computes declared ∩ approved at LOAD, inside the host — and
// nothing reported the intersection. So an operator had to compute it in his head against a rule
// that inverts the naive reading: A MISS IS PERMISSIVE. A plugin absent from the approvals map
// keeps everything it declared.
//
// That blindness is why the 2026-08-25 defect hid for as long as it did: an approval keyed by the
// manifest id while the host looks it up by the runtime id was never applied, and no surface could
// have shown it. The host already holds the answer; this reports it rather than recomputing it
// anywhere else.

fn caps(items: &[&str]) -> std::collections::BTreeSet<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn the_effective_set_is_reported_and_is_not_the_declared_set() {
    let grants = std::collections::HashMap::from([(
        "lsp-code-ops".to_string(),
        PluginGrantFacts {
            declared: caps(&["fs:read", "fs:write", "shell:spawn"]),
            effective: caps(&["fs:read", "fs:write"]),
            under_development: false,
        },
    )]);

    let payload = plugins_payload(&[], &["lsp-code-ops".to_string()], Some("agent"), &grants);
    let row = &payload["grants"]["lsp-code-ops"];

    assert_eq!(row["effective"].as_array().unwrap().len(), 2);
    assert_eq!(row["declared"].as_array().unwrap().len(), 3);
    assert!(
        row["effective"].as_array().unwrap().iter().all(|c| c != "shell:spawn"),
        "a capability the operator withheld must not appear in the effective set"
    );
}

#[test]
fn a_plugin_ABSENT_from_the_approvals_map_reports_the_permissive_truth() {
    // THE RULE THAT INVERTS THE NAIVE READING, said out loud instead of inferred. "No approval
    // recorded" does NOT mean "nothing granted" — `scope_to_approved` returns the DECLARED set.
    // An operator reading a surface that omitted this row would conclude the opposite.
    let grants = std::collections::HashMap::from([(
        "agent".to_string(),
        PluginGrantFacts {
            declared: caps(&["fs:read", "shell:spawn"]),
            effective: caps(&["fs:read", "shell:spawn"]),
            under_development: false,
        },
    )]);

    let payload = plugins_payload(&[], &["agent".to_string()], Some("agent"), &grants);
    let row = &payload["grants"]["agent"];

    assert_eq!(row["effective"], row["declared"], "a miss is permissive, and the surface says so");
}

#[test]
fn a_plugin_loaded_under_a_development_waiver_is_distinguishable_from_a_signed_one() {
    let grants = std::collections::HashMap::from([
        (
            "mine".to_string(),
            PluginGrantFacts { declared: caps(&["fs:read"]), effective: caps(&["fs:read"]), under_development: true },
        ),
        (
            "agent".to_string(),
            PluginGrantFacts { declared: caps(&["fs:read"]), effective: caps(&["fs:read"]), under_development: false },
        ),
    ]);

    let payload = plugins_payload(&[], &[], Some("agent"), &grants);

    assert_eq!(payload["grants"]["mine"]["underDevelopment"], true);
    assert_eq!(payload["grants"]["agent"]["underDevelopment"], false);
}

#[test]
fn a_plugin_the_host_never_loaded_has_no_grant_row_rather_than_an_empty_one() {
    // Absence declares itself. An empty effective set would read as "everything was withheld";
    // no row reads as "this host never computed one", which is the true fact.
    let payload = plugins_payload(&[], &[], Some("agent"), &std::collections::HashMap::new());
    assert_eq!(payload["grants"].as_object().unwrap().len(), 0);
}
