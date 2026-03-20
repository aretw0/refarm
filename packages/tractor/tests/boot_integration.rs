/// Phase 7 integration tests — TractorNative boot cycle (BDD + TDD).
///
/// Spec: docs/specs/phase7-public-api.md §7 — Test Matrix
///
/// Each test maps to a BDD scenario from the SDD; the test name IS the scenario.
use std::path::Path;
use tractor::{TractorNative, TractorNativeConfig};

fn memory_config() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        ..TractorNativeConfig::default()
    }
}

// ── 1. boot_default_config_succeeds ──────────────────────────────────────────

/// BDD: Given a valid in-memory config, when boot() is called,
/// then all subsystems are available and no error is returned.
#[tokio::test]
async fn boot_default_config_succeeds() {
    let result = TractorNative::boot(memory_config()).await;
    assert!(result.is_ok(), "boot() with :memory: must succeed: {:?}", result.err());
}

// ── 2. boot_creates_sync_ready_to_store ──────────────────────────────────────

/// BDD: Given a booted TractorNative, when a node is stored via tractor.sync,
/// then the same node is retrievable by the same sync instance.
#[tokio::test]
async fn boot_creates_sync_ready_to_store() {
    let tractor = TractorNative::boot(memory_config()).await.expect("boot must succeed");

    tractor
        .sync
        .store_node("urn:test:boot-1", "Note", None, "{}", None)
        .expect("store_node must succeed after boot");

    let node = tractor
        .sync
        .get_node("urn:test:boot-1")
        .expect("get_node must not error");

    // get_node returns the payload field; its presence confirms the write→read cycle
    assert!(node.is_some(), "stored node must be retrievable after boot");
}

// ── 3. boot_shutdown_is_clean ─────────────────────────────────────────────────

/// BDD: Given a booted TractorNative, when shutdown() is called,
/// then it returns Ok and does not panic.
#[tokio::test]
async fn boot_shutdown_is_clean() {
    let tractor = TractorNative::boot(memory_config()).await.expect("boot must succeed");
    let result = tractor.shutdown().await;
    assert!(result.is_ok(), "shutdown() must return Ok: {:?}", result.err());
}

// ── 4. boot_two_instances_independent ────────────────────────────────────────

/// BDD: Given two TractorNative instances booted with :memory:,
/// when a node is stored in instance A, then instance B does not see it.
#[tokio::test]
async fn boot_two_instances_independent() {
    let a = TractorNative::boot(memory_config()).await.expect("boot A must succeed");
    let b = TractorNative::boot(memory_config()).await.expect("boot B must succeed");

    a.sync
        .store_node("urn:test:isolation-1", "Note", None, "{}", None)
        .expect("store in A must succeed");

    let in_b = b
        .sync
        .get_node("urn:test:isolation-1")
        .expect("get_node on B must not error");

    assert!(
        in_b.is_none(),
        "node stored in instance A must not appear in instance B"
    );
}

// ── 5. load_plugin_path_not_found_returns_error ───────────────────────────────

/// BDD: Given a booted TractorNative, when load_plugin() is called with a
/// nonexistent path, then it returns Err and does not panic.
#[tokio::test]
async fn load_plugin_path_not_found_returns_error() {
    let tractor = TractorNative::boot(memory_config()).await.expect("boot must succeed");

    let result = tractor
        .load_plugin(Path::new("/nonexistent/path/plugin.wasm"))
        .await;

    assert!(
        result.is_err(),
        "load_plugin with nonexistent path must return Err, not panic"
    );
}
