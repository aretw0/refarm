//! Identity provider integration harness — the FIRST real SPI provider, end to end.
//!
//! Proves the sovereign identity plugin (`@refarm.dev/identity-provider-ref`) answers
//! `identity:whoami` on the REAL runtime, and that the registry resolves it via the SPI
//! (`providesApi: identity:v1`) — the two seams the host's `get_identity` uses. The host
//! resolves an `identity:v1` provider (`plugin_providing_api`) and dispatches
//! `identity:whoami` to it (the same dispatch `call_plugin` uses); the provider answers
//! with the citizen's SOVEREIGN identity (the DID of the PUBLIC key — the private key
//! never leaves the sandbox), stored back as a `DispatchResult` node.
//!
//! # Requires
//!   pnpm --filter @refarm.dev/identity-provider-ref run build:wasm   (→ dist/, gitignored)
//!
//! # Run
//!   cargo test --test identity_provider_harness -- --ignored --test-threads=1

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tractor::trust::SecurityMode;
use tractor::{TractorNative, TractorNativeConfig};

static IDENTITY_WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The identity provider component (built by `@refarm.dev/identity-provider-ref`
/// `build:wasm` → its own dist/, gitignored). Beside the wasm sits its plugin.json
/// declaring `verbs.key = "identity"` + `providesApi: ["identity:v1"]`, so loading from
/// dist/ puts `identity:whoami` + the `api:identity:v1` resolution into the registry.
fn identity_wasm_path() -> &'static Path {
    IDENTITY_WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../identity-provider-ref/dist/identity_provider.wasm")
    })
}

/// Memory-only, security-off runtime — the untrusted provider must load (not the default
/// Strict gate). Mirrors delegate_plugin_harness / vault_plugin_harness.
fn memory_config_none() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..TractorNativeConfig::default()
    }
}

/// Load the identity provider + register its events (so `identity:dispatch` and
/// `api:identity:v1` land in the registry). Returns its id, or None (skip) if not built.
async fn load_identity(tractor: &TractorNative) -> Option<String> {
    let wasm = identity_wasm_path();
    if !wasm.exists() {
        eprintln!(
            "SKIP: identity provider wasm not found at {} — run: pnpm --filter @refarm.dev/identity-provider-ref run build:wasm",
            wasm.display()
        );
        return None;
    }
    let handle = tractor.load_plugin(wasm).await.expect("identity provider must load");
    let id = handle.id.clone();
    tractor.register_for_events(handle);
    Some(id)
}

/// Poll the graph for the provider's `DispatchResult` node keyed by `reply_ref`.
async fn await_dispatch_result(tractor: &TractorNative, reply_ref: &str) -> serde_json::Value {
    for _ in 0..300 {
        let rows = tractor.sync.query_nodes("DispatchResult").expect("query DispatchResult");
        for row in &rows {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&row.payload) {
                if v["replyRef"] == reply_ref {
                    return v;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("identity provider never stored a DispatchResult for replyRef {reply_ref}");
}

#[tokio::test]
#[ignore = "requires identity-provider-ref build:wasm; run with --ignored --test-threads=1"]
async fn harness_identity_provider_answers_whoami_over_the_spi() {
    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");
    let Some(provider_id) = load_identity(&tractor).await else {
        return; // not built — skip
    };

    // The SPI DISCOVERY seam the host's get_identity uses: the provider resolves by its
    // declared `providesApi: identity:v1`.
    let resolved = tractor
        .plugin_registry
        .plugin_providing_api("identity:v1")
        .expect("registry must resolve identity:v1 to the loaded provider");
    assert_eq!(resolved, provider_id, "resolved provider is the one we loaded");

    // The SPI CALL seam: deliver identity:whoami (the same envelope get_identity sends).
    let payload = serde_json::json!({ "verb": "whoami", "replyRef": "identity-whoami-1" })
        .to_string();
    let sent = tractor.deliver("identity:dispatch", None, Some(payload));
    assert_eq!(sent, 1, "the router must deliver identity:dispatch to the provider");

    let node = await_dispatch_result(&tractor, "identity-whoami-1").await;
    assert_eq!(node["@type"], "DispatchResult");
    // A SOVEREIGN identity, identified by the DID of the PUBLIC key.
    assert_eq!(node["result"]["identity_type"], "sovereign");
    assert_eq!(node["result"]["storage_tier"], "persistent");
    let id = node["result"]["identifier"].as_str().expect("identifier");
    assert!(
        id.starts_with("did:refarm-wasm:") && id.len() > "did:refarm-wasm:".len(),
        "identifier is the DID of the public key: {id}"
    );

    tractor.shutdown().await.expect("shutdown");
}
