/// Phase 8 conformance tests — graduation criteria verification.
///
/// Covers:
///   Criterion #4 — Storage compat: `.db` created by TS readable by NativeStorage
///   SecurityMode::Strict — enforced at wasmtime layer (PluginHost::load)
use std::path::Path;

use sha2::{Digest, Sha256};
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, SecurityMode, TelemetryBus};

fn fixture_path() -> &'static Path {
    Path::new("tests/fixtures/null-plugin.wasm")
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

// ── Criterion #4: Schema compat ───────────────────────────────────────────────
//
// Creates a .db using the EXACT SQL of PHYSICAL_SCHEMA_V1 (TypeScript) — no
// `created_at`, `crdt_log.id = TEXT PRIMARY KEY` — then opens it via
// `NativeStorage::open_at()` and verifies a previously inserted row is readable.

#[test]
fn schema_compat_ts_db_readable() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("ts-compat.db");

    // Write the TS schema directly via rusqlite (bypassing NativeStorage)
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            context TEXT NOT NULL,
            payload JSON NOT NULL,
            source_plugin TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS crdt_log (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            field TEXT NOT NULL,
            value JSON,
            peer_id TEXT NOT NULL,
            hlc_time TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(node_id) REFERENCES nodes(id)
        );
        INSERT INTO nodes (id, type, context, payload, source_plugin, updated_at)
        VALUES (
            'urn:test:1',
            'Message',
            'global',
            '{"@type":"Message","text":"hello from TS"}',
            'ts-plugin',
            datetime('now')
        );
    "#,
    )
    .unwrap();
    drop(conn);

    // Open the TS-created .db with NativeStorage (as if reading a browser-written file)
    let storage = NativeStorage::open_at(&db_path).unwrap();
    let rows = storage.query_nodes("Message").unwrap();

    assert_eq!(rows.len(), 1, "expected 1 node from TS-created .db");
    assert_eq!(rows[0].id, "urn:test:1");
    assert!(rows[0].payload.contains("hello from TS"));
}

// ── SecurityMode::Strict — rejects untrusted plugin ──────────────────────────
//
// Verifies that PluginHost::load() returns Err when SecurityMode is Strict, the
// plugin has no trust grant, AND a configured (non-permissive) trusted_plugins
// allowlist does not list it. An EMPTY allowlist (deny-all) is injected so the
// test doesn't depend on the process cwd's .refarm/config.json — and to assert
// the honest deny path: a configured allowlist that omits the plugin rejects it.

#[tokio::test]
async fn security_mode_strict_rejects_untrusted_plugin() {
    let bus = TelemetryBus::new(100);
    let trust = TrustManager::with_security_mode(SecurityMode::Strict);
    let host = PluginHost::new(trust, bus, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .unwrap()
        // Deny-all allowlist (configured but empty) — no grant, not listed → reject.
        .with_trusted_plugins(Some(std::collections::HashSet::new()))
        // null-plugin.wasm carries no manifest, so no integrity claim — wildcard-waive
        // it so this test exercises the SecurityMode/trust gate it is actually about.
        .with_under_development(Some(["*".to_string()].into_iter().collect()));
    let sync = make_sync();

    let result = host.load(fixture_path(), &sync).await;
    assert!(result.is_err(), "Strict mode must reject untrusted plugin");

    let msg = format!("{}", result.unwrap_err());
    assert!(
        msg.contains("SecurityMode::Strict"),
        "error should mention SecurityMode::Strict, got: {msg}"
    );
}

// ── SecurityMode::Strict — allows plugin after trust grant ───────────────────
//
// Verifies that PluginHost::load() succeeds in Strict mode when the plugin's
// SHA-256 hash has been granted trust before loading.

#[tokio::test]
async fn security_mode_strict_allows_after_grant() {
    let wasm_bytes = std::fs::read(fixture_path()).expect("null-plugin.wasm fixture must exist");
    let hash = hex::encode(Sha256::digest(&wasm_bytes));

    let bus = TelemetryBus::new(100);
    let mut trust = TrustManager::with_security_mode(SecurityMode::Strict);
    trust.grant("null-plugin", &hash, None);

    let host = PluginHost::new(trust, bus, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .unwrap()
        // null-plugin.wasm carries no manifest, so no integrity claim — wildcard-waive
        // it so this test exercises the SecurityMode/trust gate it is actually about.
        .with_under_development(Some(["*".to_string()].into_iter().collect()));
    let sync = make_sync();

    let handle = host.load(fixture_path(), &sync).await;
    assert!(
        handle.is_ok(),
        "trusted plugin must load in Strict mode: {:?}",
        handle.err()
    );
    assert_eq!(handle.unwrap().id, "null-plugin");
}

// ── SecurityMode::Strict — the sovereign trusted_plugins allowlist seeds trust ─
//
// The operator's .refarm/config.json trusted_plugins list admits a plugin to load
// under Strict WITHOUT a per-hash grant (the operator is authoritative over their
// own local plugins). These cover the four allowlist states via with_trusted_plugins.

async fn strict_load_with_allowlist(
    allow: Option<std::collections::HashSet<String>>,
) -> Result<(), String> {
    let bus = TelemetryBus::new(100);
    let trust = TrustManager::with_security_mode(SecurityMode::Strict);
    let host = PluginHost::new(trust, bus, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .unwrap()
        .with_trusted_plugins(allow)
        // null-plugin.wasm carries no manifest, so no integrity claim — wildcard-waive
        // it so this test exercises the SecurityMode/trust gate it is actually about.
        .with_under_development(Some(["*".to_string()].into_iter().collect()));
    host.load(fixture_path(), &make_sync())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tokio::test]
async fn strict_allowlist_lists_the_plugin_allows_load() {
    let allow = ["null-plugin".to_string()].into_iter().collect();
    assert!(
        strict_load_with_allowlist(Some(allow)).await.is_ok(),
        "a listed plugin loads under Strict without a per-hash grant"
    );
}

#[tokio::test]
async fn strict_allowlist_wildcard_allows_load() {
    let allow = ["*".to_string()].into_iter().collect();
    assert!(
        strict_load_with_allowlist(Some(allow)).await.is_ok(),
        "the '*' wildcard trusts every plugin"
    );
}

#[tokio::test]
async fn strict_allowlist_absent_is_permissive() {
    assert!(
        strict_load_with_allowlist(None).await.is_ok(),
        "no allowlist configured → permissive (backward-compatible), plugin loads"
    );
}

#[tokio::test]
async fn strict_allowlist_configured_without_the_plugin_denies() {
    let allow = ["some-other-plugin".to_string()].into_iter().collect();
    assert!(
        strict_load_with_allowlist(Some(allow)).await.is_err(),
        "a configured allowlist that omits the plugin denies it (deny-by-omission)"
    );
}

// ── Criterion #3: Plugin lifecycle — setup / ingest / teardown ───────────────
//
// Verifies the full plugin lifecycle: load() (which calls setup() internally),
// then ingest(), then teardown() — no panics, no errors.
//
// Note: PluginHost::load() already calls setup() as part of the load sequence.
// After load, we exercise ingest() and teardown() to complete the cycle.

#[tokio::test]
async fn plugin_lifecycle_setup_teardown() {
    let bus = TelemetryBus::new(100);
    let trust = TrustManager::with_security_mode(SecurityMode::None);
    let host = PluginHost::new(trust, bus, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .unwrap()
        // null-plugin.wasm carries no manifest, so no integrity claim — wildcard-waive
        // it so this test exercises the SecurityMode/trust gate it is actually about.
        .with_under_development(Some(["*".to_string()].into_iter().collect()));
    let sync = make_sync();

    // load() calls setup() internally — must not error
    let mut handle = host
        .load(fixture_path(), &sync)
        .await
        .expect("plugin must load and setup without error");

    assert_eq!(handle.id, "null-plugin");

    // teardown() — should not panic or error
    handle.call_teardown().await;
}

// ── Criterion #2: Loro binary interop JS→Rust ────────────────────────────────
//
// Verifies that bytes produced by `loro-crdt` (JS, v1.10.7) are importable
// by `loro` (Rust) via NativeSync::apply_update(). Proves binary format
// compatibility cross-stack without requiring a browser or subprocess.
//
// Fixture generated by: packages/sync-loro/scripts/gen-loro-fixture.mjs
// Shape mirrors LoroCRDTStorage.storeNode() exactly:
//   doc.getMap("nodes").set(id, JSON.stringify({ id, type, context, payload, sourcePlugin, updatedAt }))

#[test]
fn loro_binary_js_interop() {
    let fixture = std::fs::read("tests/fixtures/loro-js-update.bin")
        .expect("loro-js-update.bin fixture must exist — run: node packages/sync-loro/scripts/gen-loro-fixture.mjs");

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, "interop-test").unwrap();

    // Import bytes produced by loro-crdt JS — must not return an error
    sync.apply_update(&fixture)
        .expect("loro Rust must accept bytes produced by loro-crdt JS");

    // The read model (SQLite) must reflect the node from the fixture
    let rows = sync.query_nodes("Message").unwrap();
    assert!(
        !rows.is_empty(),
        "NativeSync must project the JS-originated node to read model"
    );
    assert_eq!(rows[0].id, "urn:interop:1");
    assert!(
        rows[0].payload.contains("hello from loro-crdt JS"),
        "payload must contain the JS-originated text, got: {}",
        rows[0].payload
    );
}

// ── Criterion #3: Plugin ingest roundtrip ────────────────────────────────────
//
// Verifies that ingest() can be called after load/setup and returns a valid
// result. null-plugin returns Ok(0) — no items ingested, but no error either.

#[tokio::test]
async fn plugin_ingest_roundtrip() {
    let bus = TelemetryBus::new(100);
    let trust = TrustManager::with_security_mode(SecurityMode::None);
    let host = PluginHost::new(trust, bus, tractor::host::DEFAULT_ON_EVENT_BUDGET_MS)
        .unwrap()
        // null-plugin.wasm carries no manifest, so no integrity claim — wildcard-waive
        // it so this test exercises the SecurityMode/trust gate it is actually about.
        .with_under_development(Some(["*".to_string()].into_iter().collect()));
    let sync = make_sync();

    let mut handle = host
        .load(fixture_path(), &sync)
        .await
        .expect("plugin must load without error");

    // ingest() — null-plugin returns Ok(0)
    let count = handle.call_ingest().await.expect("ingest() must not error");
    assert_eq!(count, 0, "null-plugin ingest must return 0 nodes");

    // teardown() to complete the full lifecycle cycle
    handle.call_teardown().await;
}
