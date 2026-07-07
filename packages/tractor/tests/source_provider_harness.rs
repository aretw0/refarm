//! Source-provider plugin harness — proves a PROVIDER arrives as a WASM extension.
//!
//! Unlike the vault/quality harnesses (which drive `on_event` fire-and-forget and
//! read back a dispatch-result node), a provider serves SYNCHRONOUSLY: the host loads
//! the component and calls its canonical `integration.respond` export, which routes by
//! `method` and returns the result JSON directly — no graph round-trip. This closes
//! the Rust↔WASM synchronous provider seam end to end on the REAL runtime.
//!
//! The provider (`@refarm.dev/source-provider-ref`) implements the canonical
//! `integration` interface (the doctrine is ONE interface — a plugin is what it
//! implements) and does its source:v1 work in `respond({method,...})`.
//!
//! # Requires
//!   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
//!   (produces dist/source_provider.wasm — gitignored, rebuilt)
//!
//! # Run
//!   cargo test --test source_provider_harness -- --ignored --test-threads=1

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

static WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

fn wasm_path() -> &'static Path {
    WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../source-provider-ref/dist/source_provider.wasm")
    })
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

#[tokio::test]
#[ignore = "requires source-provider-ref build:plugin; run with --ignored"]
async fn source_provider_respond_discover_returns_catalog() {
    let path = wasm_path();
    if !path.exists() {
        eprintln!(
            "SKIP: source_provider.wasm not found at {} — run: pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
            path.display()
        );
        return;
    }

    let sync = make_sync();
    let host = PluginHost::new(
        TrustManager::new(),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .expect("PluginHost::new");
    let mut handle = host
        .load(path, &sync)
        .await
        .expect("source provider component must load");

    // The synchronous provider call: host → guest.respond({method:"discover"}) → JSON.
    let request = serde_json::json!({ "method": "discover" }).to_string();
    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        handle.call_respond(&request),
    )
    .await
    .expect("call_respond timed out")
    .expect("respond failed");

    // The reply is the provider's catalog — read directly, no dispatch-result node.
    let parsed: serde_json::Value = serde_json::from_str(&reply).expect("reply is JSON");
    let entries = parsed["entries"].as_array().expect("catalog has entries[]");
    assert_eq!(entries.len(), 2, "the ref provider advertises two sources");
    assert_eq!(entries[0]["ref"], "wasm:sample-system-a");
    assert!(
        entries[0]["label"].is_string(),
        "each catalog entry carries a label"
    );

    // A second method routes independently — proving respond is a real method channel.
    let status_req =
        serde_json::json!({ "method": "status", "ref": "wasm:sample-system-a" }).to_string();
    let status_reply = handle
        .call_respond(&status_req)
        .await
        .expect("status respond failed");
    let status: serde_json::Value = serde_json::from_str(&status_reply).unwrap();
    assert_eq!(status["known"], true, "status knows an advertised ref");
    assert_eq!(status["materialized"], false);
}
