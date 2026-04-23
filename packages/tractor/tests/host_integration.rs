/// Phase 4 integration tests — wasmtime plugin host + WIT bindings.
///
/// These tests exercise the real PluginHost::load() + lifecycle pipeline using
/// the pre-compiled null-plugin.wasm fixture (built with cargo-component).
///
/// The null-plugin exports refarm:plugin/integration with all lifecycle stubs.
use std::path::Path;
use tractor::{NativeStorage, NativeSync, TelemetryBus};
use tractor::host::PluginHost;
use tractor::trust::TrustManager;

fn fixture_path() -> &'static Path {
    Path::new("tests/fixtures/null-plugin.wasm")
}

fn make_host(telemetry: TelemetryBus) -> PluginHost {
    let trust = TrustManager::new();
    PluginHost::new(trust, telemetry).expect("PluginHost::new")
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

// ── Basic load + setup ────────────────────────────────────────────────────────

#[tokio::test]
async fn load_null_plugin_calls_setup() {
    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();

    let handle = host.load(fixture_path(), &sync).await
        .expect("load null-plugin");

    // setup() is called during load(); the handle has the expected plugin id
    assert_eq!(handle.id, "null-plugin");
}

// ── Lifecycle methods ─────────────────────────────────────────────────────────

#[tokio::test]
async fn call_ingest_returns_zero() {
    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();
    let mut handle = host.load(fixture_path(), &sync).await.unwrap();

    let count = handle.call_ingest().await.expect("call_ingest");
    assert_eq!(count, 0);
}

#[tokio::test]
async fn call_metadata_returns_plugin_info() {
    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();
    let mut handle = host.load(fixture_path(), &sync).await.unwrap();

    let meta = handle.call_metadata().await.expect("call_metadata");
    assert_eq!(meta["name"], "null-plugin");
    assert_eq!(meta["version"], "0.1.0");
}

#[tokio::test]
async fn call_teardown_does_not_panic() {
    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();
    let mut handle = host.load(fixture_path(), &sync).await.unwrap();

    handle.call_teardown().await;
}

// ── store_node roundtrip ──────────────────────────────────────────────────────

#[tokio::test]
async fn store_node_roundtrip_via_native_sync() {
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();

    sync.store_node(
        "urn:test:1",
        "Message",
        None,
        r#"{"@type":"Message","text":"hello"}"#,
        Some("test-plugin"),
    ).expect("store_node");

    let payload = sync.get_node("urn:test:1").expect("get_node").expect("found");
    assert!(payload.contains("hello"));

    let rows = sync.query_nodes("Message").expect("query_nodes");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "urn:test:1");
}

// ── Telemetry events on load ──────────────────────────────────────────────────

#[tokio::test]
async fn load_emits_telemetry_event() {
    let bus = TelemetryBus::new(100);
    let mut sub = bus.subscribe();
    let host = make_host(bus);
    let sync = make_sync();

    host.load(fixture_path(), &sync).await.unwrap();

    let mut found = false;
    while let Ok(evt) = sub.try_recv() {
        if evt.event == "plugin:loaded" {
            found = true;
            break;
        }
    }
    assert!(found, "expected plugin:loaded telemetry event");
}

#[tokio::test]
async fn lifecycle_emits_structured_events_for_setup_ingest_teardown() {
    let bus = TelemetryBus::new(200);
    let mut sub = bus.subscribe();
    let host = make_host(bus);
    let sync = make_sync();

    let mut handle = host.load(fixture_path(), &sync).await.unwrap();
    let _ = handle.call_ingest().await.expect("call_ingest");
    handle.call_teardown().await;

    let events: Vec<_> = std::iter::from_fn(|| sub.try_recv().ok()).collect();

    let has_lifecycle = |event_name: &str, phase: &str| {
        events.iter().any(|evt| {
            evt.event == event_name
                && evt
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("phase"))
                    .and_then(|v| v.as_str())
                    == Some(phase)
                && evt
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("plugin_id"))
                    .and_then(|v| v.as_str())
                    == Some("null-plugin")
        })
    };

    assert!(has_lifecycle("plugin:lifecycle:start", "setup"));
    assert!(has_lifecycle("plugin:lifecycle:end", "setup"));
    assert!(has_lifecycle("plugin:lifecycle:start", "ingest"));
    assert!(has_lifecycle("plugin:lifecycle:end", "ingest"));
    assert!(has_lifecycle("plugin:lifecycle:start", "teardown"));
    assert!(has_lifecycle("plugin:lifecycle:end", "teardown"));
}
