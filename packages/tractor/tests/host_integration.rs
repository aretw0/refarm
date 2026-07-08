/// Phase 4 integration tests — wasmtime plugin host + WIT bindings.
///
/// These tests exercise the real PluginHost::load() + lifecycle pipeline using
/// the pre-compiled null-plugin.wasm fixture (built with cargo-component).
///
/// The null-plugin exports refarm:plugin/integration with all lifecycle stubs.
use std::path::{Path, PathBuf};
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

fn fixture_path() -> &'static Path {
    Path::new("tests/fixtures/null-plugin.wasm")
}

fn write_manifest_for_fixture(dir: &Path, id: &str, version: &str, hooks: &[&str]) -> PathBuf {
    let manifest_path = dir.join("plugin-manifest.json");
    let payload = serde_json::json!({
        "id": id,
        "name": "Null Plugin",
        "version": version,
        "entry": "./null-plugin.wasm",
        "observability": {
            "hooks": hooks,
        },
    });

    std::fs::write(
        &manifest_path,
        serde_json::to_vec(&payload).expect("manifest serialize"),
    )
    .expect("manifest write");

    manifest_path
}

fn temp_fixture_with_manifest(
    id: &str,
    version: &str,
    hooks: &[&str],
) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let wasm_path = dir.path().join("null-plugin.wasm");
    std::fs::copy(fixture_path(), &wasm_path).expect("copy wasm fixture");
    let _ = write_manifest_for_fixture(dir.path(), id, version, hooks);
    (dir, wasm_path)
}

fn make_host(telemetry: TelemetryBus) -> PluginHost {
    let trust = TrustManager::new();
    PluginHost::new(trust, telemetry, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .expect("PluginHost::new")
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

    let handle = host
        .load(fixture_path(), &sync)
        .await
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
    )
    .expect("store_node");

    let payload = sync
        .get_node("urn:test:1")
        .expect("get_node")
        .expect("found");
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

#[tokio::test]
async fn load_succeeds_with_aligned_manifest_and_runtime_metadata() {
    let (_dir, wasm_path) = temp_fixture_with_manifest(
        "@refarm.dev/null-plugin",
        "0.1.0",
        &["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
    );

    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();

    let handle = host
        .load(&wasm_path, &sync)
        .await
        .expect("load aligned plugin");
    assert_eq!(handle.id, "null-plugin");
}

#[tokio::test]
async fn load_fails_when_manifest_plugin_id_mismatches_runtime_id() {
    let (_dir, wasm_path) = temp_fixture_with_manifest(
        "@refarm.dev/other-plugin",
        "0.1.0",
        &["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
    );

    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();

    let err = host
        .load(&wasm_path, &sync)
        .await
        .expect_err("load should fail on manifest/runtime plugin_id mismatch");
    let message = err.to_string();
    assert!(
        message.contains("manifest/runtime alignment failed"),
        "expected alignment failure error, got: {message}"
    );
    assert!(
        message.contains("plugin_id mismatch"),
        "expected plugin_id mismatch detail, got: {message}"
    );
}

#[tokio::test]
async fn load_fails_when_manifest_is_missing_required_hooks() {
    let (_dir, wasm_path) = temp_fixture_with_manifest(
        "@refarm.dev/null-plugin",
        "0.1.0",
        &["onLoad", "onInit", "onRequest"],
    );

    let bus = TelemetryBus::new(100);
    let host = make_host(bus);
    let sync = make_sync();

    let err = host
        .load(&wasm_path, &sync)
        .await
        .expect_err("load should fail when manifest hooks are incomplete");
    let message = err.to_string();
    assert!(
        message.contains("observability.hooks missing required hooks"),
        "expected missing hooks detail, got: {message}"
    );
}

// ── Permission vocabulary — reject unknown capabilities ──────────────────────
//
// The permissions[] field is a CLOSED vocabulary (the effect axis). A permission
// outside the known set — e.g. a typo `fs:reed` — must fail the load, not become
// an inert dead grant that silently never enforces (matching the reject-unknown
// posture of `targets` / `trust.profile`). The manifest is otherwise fully valid
// (id resolves to the fixture's metadata name `null-plugin`, version 0.1.0, all
// five hooks) so the ONLY reason to reject is the unknown permission.

/// Stage the null-plugin fixture with a manifest declaring exactly `permissions`.
/// The manifest aligns with the fixture metadata so any load failure is
/// attributable to the permissions, not another validation issue.
fn temp_fixture_with_permissions(permissions: &[&str]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let wasm_path = dir.path().join("null-plugin.wasm");
    std::fs::copy(fixture_path(), &wasm_path).expect("copy wasm fixture");
    let payload = serde_json::json!({
        "id": "@refarm.dev/null-plugin",
        "name": "Null Plugin",
        "version": "0.1.0",
        "entry": "./null-plugin.wasm",
        "observability": { "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
        "permissions": permissions,
    });
    std::fs::write(
        dir.path().join("plugin-manifest.json"),
        serde_json::to_vec(&payload).expect("manifest serialize"),
    )
    .expect("manifest write");
    (dir, wasm_path)
}

#[tokio::test]
async fn load_fails_when_a_permission_is_outside_the_vocabulary() {
    let (_dir, wasm_path) = temp_fixture_with_permissions(&["fs:read", "fs:reed"]);

    let err = make_host(TelemetryBus::new(100))
        .load(&wasm_path, &make_sync())
        .await
        .expect_err("load must fail on a permission outside the closed vocabulary");
    let message = err.to_string();
    assert!(
        message.contains("permissions contains unknown capabilities")
            && message.contains("fs:reed"),
        "expected the unknown-permission detail naming fs:reed, got: {message}"
    );
}

#[tokio::test]
async fn load_succeeds_when_all_permissions_are_in_the_vocabulary() {
    // The full known vocabulary — every one must be accepted (no false reject).
    let (_dir, wasm_path) =
        temp_fixture_with_permissions(&["fs:read", "fs:write", "shell:spawn", "network:outbound"]);

    let handle = make_host(TelemetryBus::new(100))
        .load(&wasm_path, &make_sync())
        .await
        .expect("a manifest declaring only known permissions must load");
    assert_eq!(handle.id, "null-plugin");
}
