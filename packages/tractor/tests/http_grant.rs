//! The `network:outbound` grant as a REAL wasi:http linker boundary (end-to-end,
//! not advisory).
//!
//! The host builds two component linkers that differ ONLY in wasi:http
//! (`env_and_runtime.rs:560-567`): a plugin granted `network:outbound`
//! instantiates against `linker` (wasi:http linked); one that was not (Strict +
//! undeclared) instantiates against `linker_no_http`, where a
//! `wasi:http/outgoing-handler` import cannot resolve and instantiation fails.
//!
//! The `http-plugin` fixture imports `wasi:http/outgoing-handler` (kept alive
//! past DCE by a reachable-but-never-fired call), so it links iff the grant is
//! present. `null-plugin` cannot prove this — it imports no gated interface and
//! loads identically against either linker. See `tests/fixtures/http-plugin/README.md`.
//!
//! No manifest is placed next to the fixture, and that absence is LOAD-BEARING:
//!   - `declared_permissions` is empty (`env_and_runtime.rs:768-771`), so under
//!     Strict `grants("network:outbound")` is false → `linker_no_http` → the
//!     negative row's link failure. That is the whole enforcement proof.
//!   - `validate_manifest_runtime_alignment` is skipped entirely when there is no
//!     manifest (`:807-822`), so the negative row cannot fail for a manifest
//!     reason — only at the linker.
//! The trust gate (`:742`, upstream and independent of the network grant) is
//! passed via the sovereign allowlist / a per-hash grant, so every row exercises
//! the LINKER boundary, never the trust boundary.
//!
//! Building a WASM component is not part of a normal `cargo test` run, so the
//! fixture is a committed binary and each test SKIPS (no-op) when it is missing,
//! matching the `null-plugin.wasm` convention.

use std::path::Path;

use sha2::{Digest, Sha256};
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, SecurityMode, TelemetryBus};

/// The committed wasi:http-importing fixture, relative to the crate root (the
/// cwd during `cargo test`). Loaded directly — no tempdir, no manifest.
fn http_fixture_path() -> &'static Path {
    Path::new("tests/fixtures/http-plugin.wasm")
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

/// Graceful skip when the committed fixture is absent (mirrors the null-plugin
/// convention: a missing fixture degrades to a no-op, never a red failure).
/// Returns true when the caller should return early.
fn skip_if_missing(path: &Path, test: &str) -> bool {
    if path.exists() {
        return false;
    }
    eprintln!(
        "SKIP {test}: {} missing — rebuild via \
         (cd packages/tractor/tests/fixtures/http-plugin && cargo component build --release --target wasm32-wasip1)",
        path.display()
    );
    true
}

// ── ROW 1 — dev mode grants network:outbound → http linker → loads ───────────
//
// SecurityMode::None (dev): the trust gate short-circuits (security_mode !=
// Strict, `:742`) AND PermissionGrant::grants returns true unconditionally
// (core.rs:112) → grant_network true → the wasi:http linker is chosen → the
// fixture's outgoing-handler import resolves → load succeeds. No manifest, no
// allowlist needed. The crisp contrast to Row 3: same bytes, same import, the
// only difference is which linker the grant selects.
#[tokio::test]
async fn dev_mode_links_the_http_import_and_loads() {
    let path = http_fixture_path();
    if skip_if_missing(path, "dev_mode_links_the_http_import_and_loads") {
        return;
    }

    let host = PluginHost::new(
        TrustManager::with_security_mode(SecurityMode::None),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap();

    let handle = host.load(path, &make_sync()).await;
    assert!(
        handle.is_ok(),
        "dev mode links wasi:http and the http fixture loads: {:?}",
        handle.err()
    );
    // No manifest → plugin_id derives from the file stem.
    assert_eq!(handle.unwrap().id, "http-plugin");
}

// ── ROW 2 — Strict + manifest declares network:outbound → http linker → loads
//
// Note: trust and the network grant are ORTHOGONAL. Passing the trust gate (via
// a per-hash grant or the allowlist) does NOT grant network:outbound — under
// Strict that comes only from the manifest's declared permissions. So the honest
// positive-under-Strict proof needs a manifest that declares network:outbound,
// staged in a fresh tempdir so it is read only for THIS plugin. The manifest
// fields align with the fixture's exported metadata (id suffix "http-plugin",
// version "0.1.0", all 5 required hooks), so the post-instantiate alignment
// check also passes. Under Strict, grants("network:outbound") is true → the
// http linker → the import resolves → load succeeds. The allowlist "*" passes
// the trust gate (orthogonal to the network grant).
#[tokio::test]
async fn strict_with_declared_network_grant_links_http_and_loads() {
    let path = http_fixture_path();
    if skip_if_missing(
        path,
        "strict_with_declared_network_grant_links_http_and_loads",
    ) {
        return;
    }

    let tempdir = tempfile::tempdir().expect("tempdir");
    let staged = tempdir.path().join("http-plugin.wasm");
    std::fs::copy(path, &staged).expect("copy fixture into tempdir");
    std::fs::write(
        tempdir.path().join("plugin.json"),
        // id suffix "http-plugin" == metadata.name; version "0.1.0" == metadata.version;
        // all five required hooks; permissions declares the grant under test.
        r#"{
  "id": "@refarm/http-plugin",
  "version": "0.1.0",
  "entry": "http-plugin.wasm",
  "observability": { "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
  "capabilities": { "provides": [] },
  "permissions": ["network:outbound"]
}"#,
    )
    .expect("write plugin.json into tempdir");

    let host = PluginHost::new(
        TrustManager::with_security_mode(SecurityMode::Strict),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap()
    // "*" passes the (orthogonal) trust gate; the network grant comes from the
    // manifest's declared permissions.
    .with_trusted_plugins(Some(["*".to_string()].into_iter().collect()));

    let handle = host.load(&staged, &make_sync()).await;
    assert!(
        handle.is_ok(),
        "Strict + declared network:outbound → http linker → wasi:http import links → loads: {:?}",
        handle.err()
    );
    assert_eq!(handle.unwrap().id, "http-plugin");
}

// ── ROW 3 (the crux) — Strict + NOT declared → linker_no_http → link fails ───
//
// Grant TRUST (per-hash, so the trust gate at :742 passes) but withhold
// network:outbound: no manifest → declared_permissions empty → under Strict
// grants("network:outbound") is false → linker_no_http → the fixture's
// wasi:http/outgoing-handler import cannot resolve → instantiate_async (:805)
// errors, BEFORE any manifest validation (:809, skipped anyway with no manifest).
//
// The assertion proves WHERE it failed, so it cannot pass or fail for the wrong
// reason:
//   - is_err() — it did not load;
//   - message does NOT contain "SecurityMode::Strict" — NOT the trust bail
//     (:746), so the trust gate was passed;
//   - message contains the unresolved import name + "was not found in the
//     linker" — the exact wasmtime 26 typecheck failure (linker.rs:175),
//     proving it failed at LINK/instantiate, not manifest validation.
#[tokio::test]
async fn strict_without_declared_network_grant_fails_to_link_http() {
    let path = http_fixture_path();
    if skip_if_missing(
        path,
        "strict_without_declared_network_grant_fails_to_link_http",
    ) {
        return;
    }

    let wasm_bytes = std::fs::read(path).expect("http-plugin.wasm fixture must exist");
    let hash = hex::encode(Sha256::digest(&wasm_bytes));

    // Trust is orthogonal to the capability grant: the per-hash grant admits the
    // plugin past the trust gate; network:outbound stays undeclared (no manifest).
    // plugin_id is the file stem "http-plugin" (:719-724).
    let mut trust = TrustManager::with_security_mode(SecurityMode::Strict);
    trust.grant("http-plugin", &hash, None);

    let host = PluginHost::new(
        trust,
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap();

    let result = host.load(path, &make_sync()).await;
    assert!(
        result.is_err(),
        "Strict + undeclared network:outbound must fail: the http-less linker \
         leaves wasi:http/outgoing-handler unresolved"
    );

    // `{:#}` flattens the anyhow cause chain so the wasmtime link message is
    // visible regardless of context wrapping.
    let msg = format!("{:#}", result.unwrap_err());
    assert!(
        !msg.contains("SecurityMode::Strict"),
        "must NOT be the trust bail — the trust gate was passed; got: {msg}"
    );
    // wasmtime typechecks imports in dependency order, so the FIRST unresolved
    // one it reports is `wasi:http/types` (which `outgoing-handler` depends on),
    // not `outgoing-handler` itself. Either way it is the wasi:http boundary that
    // `linker_no_http` omits — assert on the `wasi:http` prefix (covers both) +
    // the linker-rejection phrase, which together pin it to link-time, not trust
    // (no "SecurityMode::Strict") and not manifest validation (never reached).
    assert!(
        msg.contains("wasi:http/") && msg.contains("was not found in the linker"),
        "failure must be the wasmtime linker rejecting an unresolved wasi:http import \
         (link-time, before manifest validation); got: {msg}"
    );
}

// ── The persona approval loop scopes declared permissions (enforcement) ──────
//
// The http-plugin DECLARES network:outbound in its manifest — but the operator
// APPROVED only a subset that omits it. The host intersects declared ∩ approved,
// so the effective grant drops network:outbound → linker_no_http → the wasi:http
// import cannot resolve → load fails. This proves "approving fewer capabilities
// actually restricts", end to end, through the same linker boundary the raw grant
// uses. The trust gate is passed via the "*" allowlist (orthogonal).

fn stage_http_plugin_declaring_network(tempdir: &Path) -> std::path::PathBuf {
    let staged = tempdir.join("http-plugin.wasm");
    std::fs::copy(http_fixture_path(), &staged).expect("copy fixture into tempdir");
    std::fs::write(
        tempdir.join("plugin.json"),
        r#"{
  "id": "@refarm/http-plugin",
  "version": "0.1.0",
  "entry": "http-plugin.wasm",
  "observability": { "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
  "capabilities": { "provides": [] },
  "permissions": ["network:outbound"]
}"#,
    )
    .expect("write plugin.json into tempdir");
    staged
}

#[tokio::test]
async fn approving_a_subset_scopes_out_the_network_grant_and_fails_to_link_http() {
    let path = http_fixture_path();
    if skip_if_missing(path, "approving_a_subset_scopes_out_the_network_grant") {
        return;
    }

    let tempdir = tempfile::tempdir().expect("tempdir");
    let staged = stage_http_plugin_declaring_network(tempdir.path());

    // Operator approved only fs:read for this plugin — network:outbound is DECLARED
    // but NOT approved, so declared ∩ approved omits it. Keyed on the runtime
    // plugin id ("http-plugin", the manifest id's last segment).
    let approved = std::collections::HashMap::from([(
        "http-plugin".to_string(),
        std::collections::HashSet::from(["fs:read".to_string()]),
    )]);

    let host = PluginHost::new(
        TrustManager::with_security_mode(SecurityMode::Strict),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap()
    .with_trusted_plugins(Some(["*".to_string()].into_iter().collect()))
    .with_approved_permissions(Some(approved));

    let result = host.load(&staged, &make_sync()).await;
    assert!(
        result.is_err(),
        "network:outbound is declared but not approved → scoped out → the http-less \
         linker leaves wasi:http unresolved"
    );
    let msg = format!("{:#}", result.unwrap_err());
    assert!(
        !msg.contains("SecurityMode::Strict"),
        "must NOT be the trust bail — trust gate passed; got: {msg}"
    );
    assert!(
        msg.contains("wasi:http/") && msg.contains("was not found in the linker"),
        "must fail at the linker because approval scoped out network:outbound; got: {msg}"
    );
}

#[tokio::test]
async fn approving_the_declared_network_grant_keeps_it_and_loads() {
    let path = http_fixture_path();
    if skip_if_missing(path, "approving_the_declared_network_grant_keeps_it") {
        return;
    }

    let tempdir = tempfile::tempdir().expect("tempdir");
    let staged = stage_http_plugin_declaring_network(tempdir.path());

    // Operator approved network:outbound (declared ∩ approved keeps it) → http
    // linker → the import resolves → loads. The positive control for the scope.
    let approved = std::collections::HashMap::from([(
        "http-plugin".to_string(),
        std::collections::HashSet::from(["network:outbound".to_string()]),
    )]);

    let host = PluginHost::new(
        TrustManager::with_security_mode(SecurityMode::Strict),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap()
    .with_trusted_plugins(Some(["*".to_string()].into_iter().collect()))
    .with_approved_permissions(Some(approved));

    let handle = host.load(&staged, &make_sync()).await;
    assert!(
        handle.is_ok(),
        "approved network:outbound → http linker → loads: {:?}",
        handle.err()
    );
    assert_eq!(handle.unwrap().id, "http-plugin");
}
