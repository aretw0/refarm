// Host-connection WIT surface — proves `connection_host.rs`'s `Host` trait impl
// wires the ALREADY-TESTED engine (connection_engine.rs / connection_decl.rs) to
// the plugin boundary correctly: the permission gate runs first, an undeclared
// name errors clearly, and — the whole point of the design — two different
// plugin ids sharing one declared connection get exactly ONE spawn and TWO
// claims. `release_owner`'s own correctness is already covered at the engine
// layer (`connection_engine_tests::unloading_a_plugin_releases_every_claim_it_held`);
// here it is exercised again only as the natural continuation of the sharing
// scenario, at the WIT layer.

use crate::test_support::DeclaredBaseGuard;
use crate::host::plugin_host::plugin::host::host_connection::{
    ConnectionStatus as WitConnectionStatus, Host as HostConnectionHost,
};
// `PermissionGrant` is already imported into this flattened test module by
// `capability_gate.rs` (`use crate::host::wasi_bridge::PermissionGrant;`) — a
// second import of the same path would collide (E0252), like every other
// duplicate-`use` case this module tree already documents.


/// `SOVEREIGN_DIR` has no default by design (`config_node.rs`) — the app injects
/// it. Set once to the fixed value every fixture here writes under; idempotent +
/// thread-safe (one value, never changed), the same idiom
/// `plugin_host_tests.rs::ensure_sovereign_dir_env` uses (not reusable here — a
/// different module tree, private fn).
fn ensure_sovereign_dir_env() {
    use std::sync::Once;
    static SET: Once = Once::new();
    SET.call_once(|| std::env::set_var("SOVEREIGN_DIR", ".refarm"));
}

fn write_connections_config(dir: &std::path::Path, connections_json: &str) {
    let refarm_dir = dir.join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(
        refarm_dir.join("config.json"),
        format!(r#"{{"connections":{connections_json}}}"#),
    )
    .unwrap();
}

/// A declaration that reaches `Ready` on the FIRST probe poll: `probe` is `true`
/// (exit 0, no `expect` needed), so readiness never depends on the `establish`
/// process's own lifetime — `establish` is `true` too, the cheapest real spawn
/// available. This exercises the REAL adapters (`spawn_establish_process` /
/// `run_probe`) end to end through the WIT layer; the injectable-fake state
/// machine is already covered by `connection_engine_tests`.
fn trivial_connection_json() -> &'static str {
    r#"{ "c": { "establish": ["true"], "probe": { "run": ["true"] }, "probeIntervalMs": 1, "readyTimeoutMs": 5000 } }"#
}

fn bindings_with(
    plugin_id: &str,
    grant: PermissionGrant,
    sync: NativeSync,
    registry: std::sync::Arc<ConnectionRegistry>,
) -> TractorNativeBindings {
    TractorNativeBindings::new(
        plugin_id,
        sync,
        TelemetryBus::new(10),
        HostEffectPolicy::default(),
        crate::host::wasi_bridge::ModelRoute::default(),
        None,
        grant,
        None,
        None,
        registry,
    )
}

#[tokio::test]
async fn ensure_denies_a_plugin_that_did_not_declare_connection_use() {
    // No filesystem/CWD setup: the permission gate runs BEFORE the catalog is
    // ever resolved, so this must fail regardless of what (if anything)
    // `.refarm/config.json` under the real test CWD says.
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());
    let mut bindings =
        bindings_with("untrusted-plugin", PermissionGrant::strict_declaring(&[]), sync, registry);

    let err = HostConnectionHost::ensure(&mut bindings, "anything".to_string())
        .await
        .unwrap_err();
    assert!(err.contains("connection:use"), "must name the missing permission: {err}");
}

#[tokio::test]
async fn release_and_status_are_gated_on_connection_use_too() {
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());
    let mut bindings =
        bindings_with("untrusted-plugin", PermissionGrant::strict_declaring(&[]), sync, registry);

    let release_err = HostConnectionHost::release(&mut bindings, 1).await.unwrap_err();
    assert!(release_err.contains("connection:use"), "got: {release_err}");

    let status_err = HostConnectionHost::status(&mut bindings, "anything".to_string())
        .await
        .unwrap_err();
    assert!(status_err.contains("connection:use"), "got: {status_err}");
}

#[tokio::test]
async fn ensure_of_an_undeclared_name_errors_naming_it() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap(); // no connections declared at all
    let _base = DeclaredBaseGuard::enter(dir.path());

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());
    let mut bindings = bindings_with(
        "plugin-a",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync,
        registry,
    );

    let err = HostConnectionHost::ensure(&mut bindings, "serpro-vpn".to_string())
        .await
        .unwrap_err();
    assert!(
        err.contains("serpro-vpn") && err.contains("declared"),
        "must name the missing declaration: {err}"
    );
}

#[tokio::test]
async fn status_of_an_undeclared_name_also_errors_naming_it() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    let _base = DeclaredBaseGuard::enter(dir.path());

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());
    let mut bindings = bindings_with(
        "plugin-a",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync,
        registry,
    );

    let err = HostConnectionHost::status(&mut bindings, "ghost".to_string())
        .await
        .unwrap_err();
    assert!(err.contains("ghost"), "must name the missing declaration: {err}");
}

#[tokio::test]
async fn two_plugin_ids_sharing_one_connection_produce_one_spawn_and_two_claims() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    // ONE shared registry, cloned into both bindings — mirrors PluginHost holding
    // ONE Arc<ConnectionRegistry> and cloning it into every plugin's bindings at
    // load. Constructing a SEPARATE registry per bindings here would prove
    // nothing (it would trivially "pass" with two spawns) — this is exactly the
    // defect the design exists to prevent.
    let registry = std::sync::Arc::new(ConnectionRegistry::new());

    let mut plugin_a = bindings_with(
        "plugin-a",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync.clone(),
        registry.clone(),
    );
    let mut plugin_b = bindings_with(
        "plugin-b",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync,
        registry.clone(),
    );

    let state_a = HostConnectionHost::ensure(&mut plugin_a, "c".to_string())
        .await
        .expect("plugin-a ensure");
    let state_b = HostConnectionHost::ensure(&mut plugin_b, "c".to_string())
        .await
        .expect("plugin-b ensure");

    assert_eq!(registry.spawn_count("c"), 1, "one shared login, not one per plugin");
    assert_eq!(registry.claim_count("c"), 2, "each plugin holds its own claim");
    assert!(matches!(state_a.status, WitConnectionStatus::Up));
    assert!(matches!(state_b.status, WitConnectionStatus::Up));
    let claim_a = state_a.claim.expect("plugin-a claim");
    let claim_b = state_b.claim.expect("plugin-b claim");
    assert_ne!(claim_a, claim_b, "distinct claims per caller");

    // The unload path (`PluginHost::release_connection_claims`, called from
    // `TractorNative::unregister`) drops exactly ONE departed plugin's interest.
    // The already-covered `release_owner` engine test proves the mechanism;
    // this proves it composes correctly with claims minted through the WIT layer.
    registry.release_owner("plugin-a");
    assert_eq!(registry.claim_count("c"), 1, "plugin-a's claim is gone");
    assert_eq!(registry.status("c"), ConnectionStatus::Up, "still held by plugin-b");

    registry.release_owner("plugin-b");
    assert_eq!(registry.claim_count("c"), 0);
}

#[tokio::test]
async fn release_cannot_drop_another_plugins_claim() {
    // THE critical guarantee: claim ids come from ONE sequential counter
    // starting at 1, and `claim: u64` is all that crosses the WASM boundary
    // (D7) — so a plugin holding `connection:use` can enumerate ids
    // (`release(1)`, `release(2)`, …) and try to strip a claim it never
    // held. If that worked, plugin A could force plugin B's live connection
    // down (under `Linger::Idle{ms:0}`, or simply starve B down to a state
    // where B's next `ensure` re-logs-in) — exactly the harm the shared-
    // connection design exists to prevent. `release` must check OWNERSHIP,
    // not just the id's existence.
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());

    let mut plugin_a = bindings_with(
        "plugin-a",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync.clone(),
        registry.clone(),
    );
    let mut plugin_b = bindings_with(
        "plugin-b",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync,
        registry.clone(),
    );

    let claim_a = HostConnectionHost::ensure(&mut plugin_a, "c".to_string())
        .await
        .unwrap()
        .claim
        .unwrap();
    let claim_b = HostConnectionHost::ensure(&mut plugin_b, "c".to_string())
        .await
        .unwrap()
        .claim
        .unwrap();
    assert_eq!(registry.claim_count("c"), 2);

    // plugin-a calls release with plugin-b's claim id. The call succeeds
    // (lenient — a distinguishing error would let a caller fingerprint
    // another plugin's ids), but must drop NOTHING.
    HostConnectionHost::release(&mut plugin_a, claim_b).await.unwrap();
    assert_eq!(
        registry.claim_count("c"),
        2,
        "plugin-a must not be able to drop plugin-b's claim by guessing its id"
    );

    // plugin-a releasing its OWN claim still works normally.
    HostConnectionHost::release(&mut plugin_a, claim_a).await.unwrap();
    assert_eq!(registry.claim_count("c"), 1, "plugin-a's own claim is gone");

    // plugin-b's claim is released by plugin-b itself — proving it genuinely
    // survived plugin-a's attempt above, not just an unrelated count
    // coincidence (if plugin-a's release above had silently already removed
    // it, THIS release would be the idempotent no-op case and the final
    // count would still read 0, which the assertion below tells apart from
    // "count went 2 → 1 → 0 across three real releases").
    HostConnectionHost::release(&mut plugin_b, claim_b).await.unwrap();
    assert_eq!(registry.claim_count("c"), 0);
}

#[tokio::test]
async fn release_by_id_drops_only_the_named_claim_and_is_idempotent() {
    let _env = crate::test_support::env_lock();
    ensure_sovereign_dir_env();
    let dir = tempfile::tempdir().unwrap();
    write_connections_config(dir.path(), trivial_connection_json());
    let _base = DeclaredBaseGuard::enter(dir.path());

    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let registry = std::sync::Arc::new(ConnectionRegistry::new());
    let mut bindings = bindings_with(
        "plugin-a",
        PermissionGrant::strict_declaring(&["connection:use"]),
        sync,
        registry.clone(),
    );

    let state = HostConnectionHost::ensure(&mut bindings, "c".to_string()).await.unwrap();
    let claim = state.claim.unwrap();
    assert_eq!(registry.claim_count("c"), 1);

    HostConnectionHost::release(&mut bindings, claim).await.unwrap();
    assert_eq!(registry.claim_count("c"), 0);

    // A second release of the SAME (already-gone) id is a harmless no-op, never
    // an error — matches the native `Claim`-based `release`'s lenient behavior.
    HostConnectionHost::release(&mut bindings, claim).await.unwrap();
}
