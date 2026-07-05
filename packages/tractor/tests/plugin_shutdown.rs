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
    assert!(tractor.cancel_flags.read().unwrap().contains_key(&plugin_id));

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
        !tractor.cancel_flags.read().unwrap().contains_key(&plugin_id),
        "unregister must clear the plugin's cancel flag"
    );

    // A second unregister is a no-op (plugin already gone).
    assert!(
        !tractor.unregister(&plugin_id).await,
        "unregistering an absent plugin returns false"
    );

    // Shutdown after unregister still succeeds and finds nothing to drain.
    tractor.shutdown().await.expect("shutdown after unregister must succeed");
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
        tractor.cancel_flags.read().unwrap().contains_key(&plugin_id),
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
