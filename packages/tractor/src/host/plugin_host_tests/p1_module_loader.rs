/// P1 module loader tests — ADR-061
///
/// Uses inline WAT (WebAssembly Text) to synthesise minimal P1 modules without
/// requiring an external compiled artefact.  Each module satisfies the P1 plugin
/// contract: exports `memory`, `alloc(i32) -> i32`, and `on_event(i32, i32)`.
///
/// Run: cargo test --lib host::plugin_host::tests::p1_

use crate::{
    host::PluginHost,
    sync::NativeSync,
    telemetry::TelemetryBus,
    trust::{SecurityMode, TrustManager},
};
use std::io::Write as _;
use tempfile::NamedTempFile;

// ── helpers ──────────────────────────────────────────────────────────────────

fn test_plugin_host() -> PluginHost {
    let trust = TrustManager::with_security_mode(SecurityMode::Permissive);
    let telemetry = TelemetryBus::new(64);
    PluginHost::new(trust, telemetry).unwrap()
}

fn test_native_sync() -> NativeSync {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, "test").unwrap()
}

/// Compile a WAT string to a temporary .wasm file and return the path.
fn wat_to_wasm_file(wat_text: &str) -> NamedTempFile {
    let wasm_bytes = wat::parse_str(wat_text).expect("invalid WAT");
    let mut file = NamedTempFile::with_suffix(".wasm").expect("tempfile");
    file.write_all(&wasm_bytes).expect("write wasm");
    file.flush().expect("flush");
    file
}

// ── P1 module fixtures ────────────────────────────────────────────────────────

/// Minimal P1 module: memory + alloc (fixed offset 1024) + on_event (no-op).
const MINIMAL_P1_WAT: &str = r#"
(module
  (memory 1)
  (export "memory" (memory 0))

  ;; alloc: always return address 1024 (a safe static buffer within page 0)
  (func $alloc (export "alloc") (param i32) (result i32)
    i32.const 1024)

  ;; on_event: receives (ptr, len), does nothing
  (func $on_event (export "on_event") (param i32) (param i32))
)
"#;

/// P1 module that also exports setup and teardown.
const FULL_LIFECYCLE_P1_WAT: &str = r#"
(module
  (memory 1)
  (export "memory" (memory 0))

  (func $alloc (export "alloc") (param i32) (result i32)
    i32.const 1024)

  (func $setup (export "setup"))
  (func $teardown (export "teardown"))
  (func $on_event (export "on_event") (param i32) (param i32))
)
"#;

/// P1 module that exports ingest returning a count of 7.
const INGEST_P1_WAT: &str = r#"
(module
  (memory 1)
  (export "memory" (memory 0))

  (func $alloc (export "alloc") (param i32) (result i32)
    i32.const 1024)

  (func $on_event (export "on_event") (param i32) (param i32))

  (func $ingest (export "ingest") (result i32)
    i32.const 7)
)
"#;

// ── tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn p1_module_loads_without_setup_export() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let handle = host.load(file.path(), &sync).await;
    assert!(handle.is_ok(), "P1 module load failed: {:?}", handle.err());
    assert_eq!(handle.unwrap().id, file.path().file_stem().unwrap().to_str().unwrap());
}

#[tokio::test]
async fn p1_module_loads_with_full_lifecycle_exports() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(FULL_LIFECYCLE_P1_WAT);

    let handle = host.load(file.path(), &sync).await;
    assert!(handle.is_ok(), "P1 module load with full lifecycle failed: {:?}", handle.err());
}

#[tokio::test]
async fn p1_module_call_on_event_succeeds() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    let result = handle.call_on_event("user:prompt", Some("hello world")).await;
    assert!(result.is_ok(), "on_event failed: {:?}", result.err());
}

#[tokio::test]
async fn p1_module_call_on_event_with_none_payload_succeeds() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    let result = handle.call_on_event("system:tick", None).await;
    assert!(result.is_ok(), "on_event with None payload failed: {:?}", result.err());
}

#[tokio::test]
async fn p1_module_ingest_returns_count() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(INGEST_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    let count = handle.call_ingest().await.unwrap();
    assert_eq!(count, 7, "expected ingest count 7, got {count}");
}

#[tokio::test]
async fn p1_module_ingest_returns_zero_when_not_exported() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    let count = handle.call_ingest().await.unwrap();
    assert_eq!(count, 0, "ingest should return 0 when not exported");
}

#[tokio::test]
async fn p1_module_teardown_succeeds_when_not_exported() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    handle.call_teardown().await; // must not panic or error
}

#[tokio::test]
async fn p1_module_metadata_returns_stub() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let mut handle = host.load(file.path(), &sync).await.unwrap();
    let meta = handle.call_metadata().await.unwrap();
    assert_eq!(meta["version"].as_str().unwrap(), "unknown");
    assert!(meta["description"].as_str().unwrap().contains("P1"));
}

#[tokio::test]
async fn p1_module_debug_shows_variant() {
    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(MINIMAL_P1_WAT);

    let handle = host.load(file.path(), &sync).await.unwrap();
    let dbg = format!("{handle:?}");
    assert!(dbg.contains("p1-module"), "debug should show variant: {dbg}");
}
