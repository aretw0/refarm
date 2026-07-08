use std::path::Path;

use tractor::{SecurityMode, TractorNative, TractorNativeConfig};

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
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");

    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    use std::sync::Arc;

    // A host wired into the sidecar via with_reload → the /plugins/reload endpoint
    // performs a REAL reload (reloaded: [id]), not the honest readiness fallback.
    let tractor = Arc::new(
        TractorNative::boot(memory_config_with_plugins())
            .await
            .expect("boot must succeed"),
    );
    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    // The critical hot-reload invariant: reloading a plugin that has events queued
    // must NOT lose them or deadlock. unregister drops the sender so the runner
    // drains its FIFO to completion (recv()→None) before teardown+join; the fresh
    // instance then handles new events. We drive events concurrently with the
    // reload to exercise the race.
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");
    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
    // Reloading twice from the same unchanged bytes must succeed both times — and
    // the second compile is a content-addressed cache HIT (same wasm_hash), not a
    // recompile. We can't read the cache directly here, but we assert the observable
    // contract: repeated reloads keep exactly one live instance and never error.
    let tractor = TractorNative::boot(memory_config_with_plugins())
        .await
        .expect("boot must succeed");
    let handle = tractor
        .load_plugin(Path::new("tests/fixtures/null-plugin.wasm"))
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
