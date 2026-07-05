//! Vault plugin integration harness — "let the plugin be the plugin", for a
//! NON-AGENT TS→WASM plugin.
//!
//! Proves the async store-node dispatch loop end-to-end on the REAL runtime: the
//! host loads the vault integration component (built from TS via jco componentize
//! — `@refarm.dev/vault-surface-ref` `build:plugin`), drives it through the same
//! `call_on_event` path the agent uses, and the plugin emits its result through
//! the REAL `tractor-bridge` `store-node` into the graph. A `query_nodes` for the
//! shared `dispatch-result:v1` type (`refarm:DispatchResult`) recovers it.
//!
//! This closes the loop the loader tests (with a test-double bridge) could only
//! approximate: here the bridge is the host's own SQLite/CRDT-backed
//! `TractorBridgeHost`, so `store-node` really persists a node.
//!
//! # Requires
//!   pnpm --filter @refarm.dev/vault-surface-ref run build:plugin
//!   (produces dist/vault_plugin.wasm — gitignored, rebuilt)
//!
//! # Run
//!   cargo test --test vault_plugin_harness -- --ignored --test-threads=1

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

static WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Resolve the vault plugin component built by `@refarm.dev/vault-surface-ref`.
/// It lives in that package's `dist/` (gitignored, rebuilt by `build:plugin`),
/// not under CARGO_TARGET_DIR, so resolve it relative to this crate.
fn wasm_path() -> &'static Path {
    WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../vault-surface-ref/dist/vault_plugin.wasm")
    })
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

/// The on-event dispatch payload: extract a KnowledgeRecord from a note's
/// frontmatter, correlated by `replyRef`.
fn dispatch_payload() -> String {
    serde_json::json!({
        "verb": "extract",
        "note": {
            "path": "20-Projects/demanda-42.md",
            "text": "---\ntitle: Demanda 42\nstate: doing\n---\n\nalpha body #project\n"
        },
        "profile": {
            "name": "p",
            "rules": [{
                "id": "extract-frontmatter",
                "verb": "extract",
                "match": "{\"type\":\"frontmatter\",\"recordType\":\"refarm:VaultRecord\"}"
            }]
        },
        "replyRef": "harness-req-1"
    })
    .to_string()
}

#[tokio::test]
#[ignore = "requires vault-surface-ref build:plugin; run with --ignored"]
async fn vault_plugin_dispatch_stores_result_node_via_real_bridge() {
    let path = wasm_path();
    if !path.exists() {
        eprintln!(
            "SKIP: vault_plugin.wasm not found at {} — run: pnpm --filter @refarm.dev/vault-surface-ref run build:plugin",
            path.display()
        );
        return;
    }

    // The REAL host bridge: store-node writes into this sync's SQLite/CRDT graph.
    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100))
        .expect("PluginHost::new");
    let mut handle = host
        .load(path, &sync)
        .await
        .expect("vault plugin component must load");

    // Drive the plugin exactly as the runtime does — through on_event.
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        handle.call_on_event("vault:dispatch", Some(&dispatch_payload())),
    )
    .await
    .expect("call_on_event timed out")
    .expect("on_event failed");

    // The extract verb emits the KnowledgeRecord as its own node...
    let records = sync
        .query_nodes("refarm:VaultRecord")
        .expect("query refarm:VaultRecord");
    assert!(
        !records.is_empty(),
        "extract must store a refarm:VaultRecord node via the real tractor-bridge"
    );

    // ...and a correlated dispatch-result:v1 node the caller finds by replyRef.
    let results = sync
        .query_nodes("refarm:DispatchResult")
        .expect("query refarm:DispatchResult");
    assert!(
        !results.is_empty(),
        "dispatch must store a refarm:DispatchResult node"
    );
    let result: serde_json::Value =
        serde_json::from_str(&results[0].payload).expect("result node is JSON");
    assert_eq!(
        result["@type"], "refarm:DispatchResult",
        "result node carries the shared dispatch-result:v1 type"
    );
    assert_eq!(
        result["refarm:replyRef"], "harness-req-1",
        "the dispatch-result node carries the replyRef for content-based correlation"
    );
}
