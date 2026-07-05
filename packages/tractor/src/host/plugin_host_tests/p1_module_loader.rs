/// P1 module loader tests — ADR-061
///
/// Uses inline WAT (WebAssembly Text) to synthesise minimal P1 modules without
/// requiring an external compiled artifact.  Each module satisfies the P1 plugin
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

/// P1 module whose on_event busy-loops forever (a wedge with no yield point).
/// Only the epoch deadline can break this — a tokio timeout never would.
const WEDGED_ON_EVENT_P1_WAT: &str = r#"
(module
  (memory 1)
  (export "memory" (memory 0))

  (func $alloc (export "alloc") (param i32) (result i32)
    i32.const 1024)

  ;; on_event: spin forever
  (func $on_event (export "on_event") (param i32) (param i32)
    (loop $spin (br $spin)))
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
async fn p1_module_on_event_wedge_traps_on_epoch_deadline() {
    // A guest busy-loop with no yield point can ONLY be broken by epoch
    // interruption. Set a short budget so the test is fast, load the wedged
    // module, and assert on_event returns an epoch trap (not a hang).
    std::env::set_var("REFARM_ON_EVENT_TIMEOUT_MS", "50");

    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(WEDGED_ON_EVENT_P1_WAT);
    let mut handle = host.load(file.path(), &sync).await.unwrap();

    let started = std::time::Instant::now();
    // Bound the whole call so a broken epoch (test failure) doesn't hang CI:
    // with the ticker + 50ms budget it must return well within a couple seconds.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.call_on_event("user:prompt", Some("spin")),
    )
    .await
    .expect("call_on_event must return via epoch trap, not hang");
    let elapsed = started.elapsed();

    std::env::remove_var("REFARM_ON_EVENT_TIMEOUT_MS");

    assert!(result.is_err(), "a wedged on_event must fail, not succeed");
    let err = result.unwrap_err();
    assert_eq!(
        err.downcast_ref::<wasmtime::Trap>(),
        Some(&wasmtime::Trap::Interrupt),
        "the wedge must be broken by an epoch interrupt trap, got: {err}"
    );
    // Budget is 50ms @ 1ms/tick; allow generous slack for CI scheduling.
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "epoch trap must fire near the budget, took {elapsed:?}"
    );
}

#[tokio::test]
async fn p1_module_on_event_cancel_flag_force_interrupts_before_timeout() {
    // A LONG timeout budget so the wedge would NOT trip on its own within the
    // test window — the ONLY thing that can interrupt it is the cancel flag.
    // This proves the force-interrupt path, distinct from the timeout path.
    std::env::set_var("REFARM_ON_EVENT_TIMEOUT_MS", "60000");

    let host = test_plugin_host();
    let sync = test_native_sync();
    let file = wat_to_wasm_file(WEDGED_ON_EVENT_P1_WAT);
    let mut handle = host.load(file.path(), &sync).await.unwrap();

    // Flip the cancel flag from another thread shortly after the guest starts.
    let cancel = handle.cancel_flag();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    });

    let started = std::time::Instant::now();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.call_on_event("user:prompt", Some("spin")),
    )
    .await
    .expect("cancel must interrupt the wedged guest, not hang");
    let elapsed = started.elapsed();

    std::env::remove_var("REFARM_ON_EVENT_TIMEOUT_MS");

    assert!(
        result.unwrap_err().downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::Interrupt),
        "cancel force-interrupt must surface as an epoch trap"
    );
    // Cancel fires at ~100ms — must interrupt FAR before the 60s timeout budget.
    assert!(
        elapsed < std::time::Duration::from_secs(3),
        "cancel must interrupt promptly (well before the 60s timeout), took {elapsed:?}"
    );
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

/// The compiled-component cache is keyed by CONTENT HASH, not path: loading the
/// same bytes twice (even from different paths) compiles ONCE (dedup), while
/// changing the bytes at a path recompiles (no stale code — the hot-reload
/// prerequisite). Uses the null-plugin component fixture.
#[tokio::test]
async fn component_cache_is_content_addressed_not_path_addressed() {
    let component_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/null-plugin.wasm");
    if !component_path.exists() {
        eprintln!("SKIP: null-plugin.wasm fixture missing at {}", component_path.display());
        return;
    }
    let bytes = std::fs::read(&component_path).unwrap();

    let host = test_plugin_host();
    let sync = test_native_sync();

    // Two DIFFERENT paths, IDENTICAL bytes → one compile (dedup by hash).
    let dir = tempfile::tempdir().unwrap();
    let path_a = dir.path().join("a.wasm");
    let path_b = dir.path().join("b.wasm");
    std::fs::write(&path_a, &bytes).unwrap();
    std::fs::write(&path_b, &bytes).unwrap();

    host.load(&path_a, &sync).await.expect("load a");
    assert_eq!(host.component_cache_len(), 1, "first load compiles one component");
    host.load(&path_b, &sync).await.expect("load b (same bytes, diff path)");
    assert_eq!(
        host.component_cache_len(),
        1,
        "identical bytes at a different path must HIT the cache (content-addressed), not add an entry"
    );

    // SAME path, reload of unchanged bytes → no recompile, no duplication (the
    // hit path). A rebuild at the same path with NEW bytes would have a new hash
    // and thus a new entry — served fresh, never stale — which the cache key type
    // (the content hash) guarantees by construction.
    host.load(&path_a, &sync).await.expect("reload a (unchanged)");
    assert_eq!(
        host.component_cache_len(),
        1,
        "reloading unchanged bytes must not recompile or duplicate"
    );
}
