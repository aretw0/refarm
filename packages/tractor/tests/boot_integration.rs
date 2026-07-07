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
    assert!(
        result.is_ok(),
        "boot() with :memory: must succeed: {:?}",
        result.err()
    );
}

// ── 2. boot_creates_sync_ready_to_store ──────────────────────────────────────

/// BDD: Given a booted TractorNative, when a node is stored via tractor.sync,
/// then the same node is retrievable by the same sync instance.
#[tokio::test]
async fn boot_creates_sync_ready_to_store() {
    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");

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
    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");
    let result = tractor.shutdown().await;
    assert!(
        result.is_ok(),
        "shutdown() must return Ok: {:?}",
        result.err()
    );
}

// ── 4. boot_two_instances_independent ────────────────────────────────────────

/// BDD: Given two TractorNative instances booted with :memory:,
/// when a node is stored in instance A, then instance B does not see it.
#[tokio::test]
async fn boot_two_instances_independent() {
    let a = TractorNative::boot(memory_config())
        .await
        .expect("boot A must succeed");
    let b = TractorNative::boot(memory_config())
        .await
        .expect("boot B must succeed");

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
    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");

    let result = tractor
        .load_plugin(Path::new("/nonexistent/path/plugin.wasm"))
        .await;

    assert!(
        result.is_err(),
        "load_plugin with nonexistent path must return Err, not panic"
    );
}

// ── E3: load a plugin by content hash from the content-addressed store ─────────

/// The manifest (pointer) a plugin travels with — carries the id + hooks. Paired
/// with the content-addressed bytes to reconstruct the install layout. The id must
/// align with what the .wasm reports at runtime (the host rejects a lying manifest),
/// so this uses the null-plugin fixture's real id.
fn round_trip_manifest(integrity: &str) -> String {
    format!(
        r#"{{"id":"null-plugin","version":"0.1.0","entry":"plugin.wasm",
            "observability":{{"hooks":["onLoad","onInit","onRequest","onError","onTeardown"]}},
            "integrity":"{integrity}"}}"#
    )
}

/// grant → hash → bytes: a device stores the .wasm by hash (E2) and can load it
/// back by that hash from the content-store, verified, with the manifest (pointer)
/// supplying the real id/permissions. Proves the round-trip AND that E1's integrity
/// check passes when the manifest's declared hash matches the stored bytes.
#[tokio::test]
async fn load_plugin_by_hash_round_trips_from_the_content_store() {
    use sha2::{Digest, Sha256};

    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");

    // Stand up a content-store: <assets_dir>/<hash> holds the fixture bytes.
    let assets = tempfile::tempdir().unwrap();
    let bytes = std::fs::read("tests/fixtures/null-plugin.wasm")
        .expect("null-plugin.wasm fixture must exist");
    let hash = hex::encode(Sha256::digest(&bytes));
    std::fs::write(assets.path().join(&hash), &bytes).unwrap();

    // The manifest declares the SAME hash as integrity (E1 verifies it at load).
    let manifest = round_trip_manifest(&format!("sha256-{hash}"));
    let handle = tractor.load_plugin_by_hash(assets.path(), &hash, &manifest).await;
    assert!(
        handle.is_ok(),
        "a plugin stored by hash must load from the content-store with its manifest: {:?}",
        handle.err()
    );
    // The manifest's id — NOT the hash-as-id fallback — proves the pointer was honored.
    assert_eq!(handle.unwrap().id, "null-plugin");
}

/// The content-store may hold bytes from any origin; an entry whose contents do
/// NOT hash to the requested hash is REJECTED, never loaded (tamper safety).
#[tokio::test]
async fn load_plugin_by_hash_rejects_a_tampered_content_store_entry() {
    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");

    let assets = tempfile::tempdir().unwrap();
    // Claim a hash but store DIFFERENT bytes under it (a tampered/corrupt entry).
    let claimed_hash = "0".repeat(64);
    std::fs::write(assets.path().join(&claimed_hash), b"not the real wasm").unwrap();

    let manifest = round_trip_manifest(&format!("sha256-{claimed_hash}"));
    let result = tractor.load_plugin_by_hash(assets.path(), &claimed_hash, &manifest).await;
    assert!(result.is_err(), "a hash-mismatched content-store entry must be rejected");
    assert!(
        result.unwrap_err().to_string().contains("rejected"),
        "the rejection must name the tamper/corruption"
    );
}

/// A content-store miss (no entry for the hash) returns Err, not a panic.
#[tokio::test]
async fn load_plugin_by_hash_missing_entry_returns_error() {
    let tractor = TractorNative::boot(memory_config())
        .await
        .expect("boot must succeed");
    let assets = tempfile::tempdir().unwrap();

    let result = tractor
        .load_plugin_by_hash(assets.path(), &"a".repeat(64), &round_trip_manifest("sha256-aa"))
        .await;
    assert!(result.is_err(), "a content-store miss must return Err");
}
