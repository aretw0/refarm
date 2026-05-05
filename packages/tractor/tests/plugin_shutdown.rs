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
        tractor.agent_channels.read().expect("channels poisoned").len(),
        1,
        "expected one registered plugin channel before shutdown"
    );

    tractor.shutdown().await.expect("shutdown must succeed");

    assert!(
        tractor
            .agent_channels
            .read()
            .expect("channels poisoned")
            .is_empty(),
        "shutdown must drain plugin channels"
    );
}
