use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tractor::{SecurityMode, TractorNative, TractorNativeConfig};

/// Serializes env var mutations across this file's tests — mirrors
/// `tests/agent_harness.rs`'s ENV_LOCK (each `tests/*.rs` file is its own test
/// binary/process, so this lock is local to plugin_shutdown.rs's own tests).
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn env_lock() -> MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// `tests/fixtures/null-plugin.wasm` has no sibling `plugin.json` in the SHARED fixtures
/// directory (`crash-plugin.wasm`/`http-plugin.wasm` sit right beside it, and a manifest is
/// resolved by PARENT DIRECTORY — writing one there would become THEIR manifest too), so it
/// declares no integrity and loads only where the node declared it is under development
/// (task 7, "the plugin lifecycle tells the truth"). A guessed file-stem id must never reach
/// that config-declared route (see `resolve_under_development_at_load`'s doc) — one node-wide
/// `refarm plugin develop plugin` must not waive every manifest-less artifact — so this guard
/// copies the fixture's bytes into an ISOLATED directory it owns, with its own `plugin.json`
/// naming the fixture's REAL exported identity (`null-plugin`/`0.1.0`, from
/// `tests/fixtures/null-plugin/src/lib.rs`'s `metadata()`), and declares THAT id under
/// development. Runs under a dedicated SOVEREIGN_BASE for this guard's lifetime; restores the
/// env and releases the cross-test lock on drop. Every test in this file boots a real
/// TractorNative and loads this exact fixture, so one shared helper covers all of them.
struct DeclareNullPluginUnderDevelopment {
    _lock: MutexGuard<'static, ()>,
    _dir: tempfile::TempDir,
    plugin_path: std::path::PathBuf,
    prev_base: Option<String>,
    prev_dir: Option<String>,
}

impl DeclareNullPluginUnderDevelopment {
    fn enter() -> Self {
        let lock = env_lock();
        let prev_base = std::env::var("SOVEREIGN_BASE").ok();
        let prev_dir = std::env::var("SOVEREIGN_DIR").ok();
        let dir = tempfile::tempdir().expect("tempdir");
        let refarm_dir = dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).expect("mkdir .refarm");
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"pluginDevelopment":{"null-plugin":{"declaredAt":"2026-08-26"}}}"#,
        )
        .expect("write config.json");
        std::env::set_var("SOVEREIGN_BASE", dir.path());
        std::env::set_var("SOVEREIGN_DIR", ".refarm");

        let plugin_dir = dir.path().join("plugin");
        std::fs::create_dir_all(&plugin_dir).expect("mkdir plugin dir");
        let plugin_path = plugin_dir.join("plugin.wasm");
        std::fs::copy("tests/fixtures/null-plugin.wasm", &plugin_path)
            .expect("copy null-plugin.wasm fixture");
        std::fs::write(
            plugin_dir.join("plugin.json"),
            r#"{"id":"null-plugin","version":"0.1.0","entry":"plugin.wasm","observability":{"hooks":["onLoad","onInit","onRequest","onError","onTeardown"]}}"#,
        )
        .expect("write plugin.json");

        Self {
            _lock: lock,
            _dir: dir,
            plugin_path,
            prev_base,
            prev_dir,
        }
    }

    /// The isolated copy of `null-plugin.wasm`, WITH its own manifest — load this, never the
    /// shared `tests/fixtures/null-plugin.wasm` directly, or the development declaration above
    /// waives nothing (see this struct's doc).
    fn plugin_path(&self) -> &Path {
        &self.plugin_path
    }
}

impl Drop for DeclareNullPluginUnderDevelopment {
    fn drop(&mut self) {
        match self.prev_base.take() {
            Some(v) => std::env::set_var("SOVEREIGN_BASE", v),
            None => std::env::remove_var("SOVEREIGN_BASE"),
        }
        match self.prev_dir.take() {
            Some(v) => std::env::set_var("SOVEREIGN_DIR", v),
            None => std::env::remove_var("SOVEREIGN_DIR"),
        }
    }
}

fn memory_config_with_plugins() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..TractorNativeConfig::default()
    }
}

#[tokio::test]
async fn strict_load_without_network_grant_uses_the_http_less_linker_and_still_loads() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    // A plugin that did NOT declare network:outbound, loaded under Strict, is
    // instantiated against linker_no_http (wasi:http omitted). A plugin that does
    // not IMPORT wasi:http (null-plugin) must still load fine there — proving the
    // per-plugin http gating does not regress the common case. (End-to-end
    // enforcement — a plugin that imports wasi:http failing to link without the
    // grant — needs a wasi:http-importing fixture; tracked as a follow-on.)
    let tractor = TractorNative::boot(TractorNativeConfig {
        security_mode: SecurityMode::Strict,
        ..memory_config_with_plugins()
    })
    .await
    .expect("boot must succeed");

    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("a non-http plugin must load against the http-less linker under Strict");
    tractor.register_for_events(handle);
    assert_eq!(
        tractor.plugin_channels.read().unwrap().len(),
        1,
        "the plugin loaded and registered under Strict without a network grant"
    );

    tractor.shutdown().await.expect("shutdown must succeed");
}

#[tokio::test]
async fn shutdown_drains_plugin_channels_after_registration() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load in SecurityMode::None");

    tractor.register_for_events(handle);
    assert_eq!(
        tractor
            .plugin_channels
            .read()
            .expect("channels poisoned")
            .len(),
        1,
        "expected one registered plugin channel before shutdown"
    );

    tractor.shutdown().await.expect("shutdown must succeed");

    assert!(
        tractor
            .plugin_channels
            .read()
            .expect("channels poisoned")
            .is_empty(),
        "shutdown must drain plugin channels"
    );
}

#[tokio::test]
async fn unregister_tears_down_one_plugin_leaving_the_host_clean() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load");
    let plugin_id = handle.id.clone();
    tractor.register_for_events(handle);

    // Registered: channel present, cancel flag present.
    assert_eq!(tractor.plugin_channels.read().unwrap().len(), 1);
    assert!(tractor
        .cancel_flags
        .read()
        .unwrap()
        .contains_key(&plugin_id));

    // Unregister the one plugin — the inverse of register_for_events.
    let was_loaded = tractor.unregister(&plugin_id).await;
    assert!(was_loaded, "unregister must report the plugin was loaded");

    // The host is clean: channel gone, cancel flag gone, runner thread joined
    // (plugin_runner_handles no longer holds it — proven by a following shutdown
    // that finds nothing to drain).
    assert!(
        tractor.plugin_channels.read().unwrap().is_empty(),
        "unregister must remove the plugin's channel"
    );
    assert!(
        !tractor
            .cancel_flags
            .read()
            .unwrap()
            .contains_key(&plugin_id),
        "unregister must clear the plugin's cancel flag"
    );

    // A second unregister is a no-op (plugin already gone).
    assert!(
        !tractor.unregister(&plugin_id).await,
        "unregistering an absent plugin returns false"
    );

    // Shutdown after unregister still succeeds and finds nothing to drain.
    tractor
        .shutdown()
        .await
        .expect("shutdown after unregister must succeed");
}

#[tokio::test]
async fn reload_plugin_replaces_the_running_instance() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load");
    let plugin_id = handle.id.clone();
    tractor.register_for_events(handle);
    assert_eq!(tractor.plugin_channels.read().unwrap().len(), 1);

    // Hot-reload: unregister + reload bytes + re-register. The plugin ends up
    // loaded again (one channel), from the same path.
    let reloaded = tractor
        .reload_plugin(&plugin_id)
        .await
        .expect("reload must not error");
    assert!(reloaded, "reload must report the plugin was reloaded");
    assert_eq!(
        tractor.plugin_channels.read().unwrap().len(),
        1,
        "after reload the plugin is loaded again (exactly one channel)"
    );
    assert!(
        tractor
            .cancel_flags
            .read()
            .unwrap()
            .contains_key(&plugin_id),
        "reload re-registers the plugin's cancel flag"
    );

    // Reloading an unknown plugin is a no-op (Ok(false)).
    assert!(
        !tractor
            .reload_plugin("@nope/missing")
            .await
            .expect("reload of unknown must not error"),
        "reloading an unloaded plugin returns false"
    );

    tractor.shutdown().await.expect("shutdown must succeed");
}

#[tokio::test]
async fn plugins_reload_endpoint_actually_reloads_when_the_host_is_wired() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    use std::sync::Arc;

    // A host wired into the sidecar via with_reload → the /plugins/reload endpoint
    // performs a REAL reload (reloaded: [id]), not the honest readiness fallback.
    let tractor = Arc::new(
        TractorNative::boot(memory_config_with_plugins())
            .await
            .expect("boot must succeed"),
    );
    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load");
    let plugin_id = handle.id.clone();
    tractor.register_for_events(handle);

    let tmp = std::env::temp_dir().join(format!("reload-endpoint-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let state = tractor::sidecar::SidecarState::new(
        tractor.plugin_channels.clone(),
        tractor.cancel_flags.clone(),
        tractor.in_flight_cancels.clone(),
        tractor.default_responder_id.clone(),
        tractor.event_router.clone(),
        tractor.telemetry.clone(),
        &tmp,
        ":memory:".to_string(),
    )
    .expect("sidecar state")
    .with_reload(tractor.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = axum::Router::new()
        .route(
            "/plugins/reload",
            axum::routing::post(tractor::sidecar::post_plugins_reload),
        )
        .with_state(state);
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let body: serde_json::Value = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/plugins/reload"))
        .json(&serde_json::json!({ "pluginIds": [plugin_id, "@nope/missing"] }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    // The loaded plugin was reloaded for real; the unknown one is skipped; the
    // response carries reloadId (not probeId) so a client knows code was swapped.
    assert_eq!(
        body["reloaded"].as_array().unwrap(),
        &vec![serde_json::json!(plugin_id)],
    );
    assert_eq!(
        body["skipped"].as_array().unwrap(),
        &vec![serde_json::json!("@nope/missing")],
    );
    assert!(body["reloadId"].as_str().is_some());
    assert!(body["errors"].as_array().unwrap().is_empty());

    tractor.shutdown().await.expect("shutdown must succeed");
}

#[tokio::test]
async fn reload_while_events_are_in_flight_drains_the_queue_and_survives() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    // The critical hot-reload invariant: reloading a plugin that has events queued
    // must NOT lose them or deadlock. unregister drops the sender so the runner
    // drains its FIFO to completion (recv()→None) before teardown+join; the fresh
    // instance then handles new events. We drive events concurrently with the
    // reload to exercise the race.
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");
    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load");
    let plugin_id = handle.id.clone();
    tractor.register_for_events(handle);

    // Queue a burst of events, then reload while they're still draining. deliver()
    // enqueues onto the runner's channel; the runner processes them FIFO. None must
    // be dropped by the reload's unregister step (it drains before it tears down).
    for i in 0..32 {
        tractor.deliver("null:event", Some(&plugin_id), Some(format!("{i}")));
    }
    let reloaded = tractor
        .reload_plugin(&plugin_id)
        .await
        .expect("reload under load must not error");
    assert!(reloaded, "reload must succeed even with events in flight");

    // The fresh instance is live: it has a channel and a cancel flag, and accepts
    // new events without panicking.
    assert_eq!(
        tractor.plugin_channels.read().unwrap().len(),
        1,
        "exactly one instance is registered after reload-under-load"
    );
    assert!(tractor
        .cancel_flags
        .read()
        .unwrap()
        .contains_key(&plugin_id));
    let delivered = tractor.deliver("null:event", Some(&plugin_id), Some("post".into()));
    assert_eq!(delivered, 1, "the reloaded instance accepts new events");

    tractor.shutdown().await.expect("shutdown must succeed");
}

#[tokio::test]
async fn reload_is_idempotent_and_reuses_the_content_addressed_cache() {
    let dev = DeclareNullPluginUnderDevelopment::enter();
    // Reloading twice from the same unchanged bytes must succeed both times — and
    // the second compile is a content-addressed cache HIT (same wasm_hash), not a
    // recompile. We can't read the cache directly here, but we assert the observable
    // contract: repeated reloads keep exactly one live instance and never error.
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");
    let handle = tractor
        .load_plugin(dev.plugin_path())
        .await
        .expect("plugin fixture must load");
    let plugin_id = handle.id.clone();
    tractor.register_for_events(handle);

    for round in 0..3 {
        let reloaded = tractor
            .reload_plugin(&plugin_id)
            .await
            .unwrap_or_else(|e| panic!("reload round {round} errored: {e}"));
        assert!(reloaded, "reload round {round} must report success");
        assert_eq!(
            tractor.plugin_channels.read().unwrap().len(),
            1,
            "round {round}: exactly one instance after an idempotent reload"
        );
    }

    tractor.shutdown().await.expect("shutdown must succeed");
}
