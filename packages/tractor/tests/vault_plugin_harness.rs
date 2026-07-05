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
use tractor::trust::{SecurityMode, TrustManager};
use tractor::{NativeStorage, NativeSync, TelemetryBus, TractorNative, TractorNativeConfig};

static WASM_PATH: OnceLock<PathBuf> = OnceLock::new();
static QUALITY_WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Resolve the vault plugin component built by `@refarm.dev/vault-surface-ref`.
/// It lives in that package's `dist/` (gitignored, rebuilt by `build:plugin`),
/// not under CARGO_TARGET_DIR, so resolve it relative to this crate.
fn wasm_path() -> &'static Path {
    WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../vault-surface-ref/dist/vault_plugin.wasm")
    })
}

/// Resolve the quality checker plugin — the SECOND family of consumer of
/// dispatch-result:v1, built by `@refarm.dev/quality-checker-plugin`.
fn quality_wasm_path() -> &'static Path {
    QUALITY_WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../quality-checker-plugin/dist/quality_plugin.wasm")
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

/// The quality:v1 dispatch payload: run a regex check over a text subject.
fn quality_payload() -> String {
    serde_json::json!({
        "subject": "As an AI language model, I cannot browse.",
        "profile": {
            "name": "text-tells",
            "rules": [{
                "id": "ai-tell",
                "severity": "warn",
                "description": "flags an AI self-reference tell",
                "check": { "type": "regex", "pattern": "AI language model" }
            }]
        },
        "replyRef": "quality-req-1"
    })
    .to_string()
}

#[tokio::test]
#[ignore = "requires quality-checker-plugin build:plugin; run with --ignored"]
async fn quality_plugin_dispatch_stores_result_node_via_real_bridge() {
    let path = quality_wasm_path();
    if !path.exists() {
        eprintln!(
            "SKIP: quality_plugin.wasm not found at {} — run: pnpm --filter @refarm.dev/quality-checker-plugin run build:plugin",
            path.display()
        );
        return;
    }

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100))
        .expect("PluginHost::new");
    let mut handle = host
        .load(path, &sync)
        .await
        .expect("quality plugin component must load");

    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        handle.call_on_event("quality:dispatch", Some(&quality_payload())),
    )
    .await
    .expect("call_on_event timed out")
    .expect("on_event failed");

    // The SECOND family (quality, not vault) emits its findings through the SAME
    // dispatch-result:v1 contract — one correlation shape, two plugin families.
    let results = sync
        .query_nodes("refarm:DispatchResult")
        .expect("query refarm:DispatchResult");
    assert!(
        !results.is_empty(),
        "quality dispatch must store a refarm:DispatchResult node"
    );
    let result: serde_json::Value =
        serde_json::from_str(&results[0].payload).expect("result node is JSON");
    assert_eq!(result["refarm:replyRef"], "quality-req-1");
    // The quality result payload carries the findings the checker produced.
    let findings = &result["refarm:result"]["findings"];
    assert!(
        findings.is_array() && !findings.as_array().unwrap().is_empty(),
        "the quality result must carry at least one finding (the AI-tell match)"
    );
    assert_eq!(findings[0]["ruleId"], "ai-tell");
}

fn memory_config_none() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..TractorNativeConfig::default()
    }
}

/// THE DECOUPLE PROOF (step 6 of the runtime-router lane): a NON-agent plugin,
/// registered at startup, receives its OWN declared event through the neutral
/// router — not the agent's user:prompt. Before the router, a vault plugin
/// registered into agent_channels would sit there and never receive
/// vault:dispatch; now the router delivers it by the plugin's
/// capabilities.subscribes declaration.
#[tokio::test]
#[ignore = "requires vault-surface-ref build:plugin; run with --ignored"]
async fn router_delivers_a_non_agent_event_to_its_subscribed_plugin() {
    let path = wasm_path();
    if !path.exists() {
        eprintln!(
            "SKIP: vault_plugin.wasm not found at {} — run: pnpm --filter @refarm.dev/vault-surface-ref run build:plugin",
            path.display()
        );
        return;
    }

    // Boot the full TractorNative (the router lives here, not on PluginHost).
    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");

    // Load the vault plugin: its plugin.json declares subscribes:[vault:dispatch].
    let handle = tractor
        .load_plugin(path)
        .await
        .expect("vault plugin must load");
    assert!(
        handle.subscribes.iter().any(|e| e == "vault:dispatch"),
        "the plugin manifest must declare subscribes:[vault:dispatch]"
    );

    // Register it — this populates the event router from the manifest, and does
    // NOT elect it as active agent (it declares no agent:respond).
    tractor.register_for_events(handle);
    assert!(
        tractor.event_router.has_subscribers("vault:dispatch"),
        "the router must have the vault plugin subscribed to vault:dispatch"
    );
    assert!(
        tractor
            .active_agent_id
            .read()
            .expect("active_agent_id poisoned")
            .is_none(),
        "a non-agent plugin must NOT be elected active agent"
    );

    // Deliver the event through the router (no explicit target -> route by
    // subscription). This is the path a caller/effort-router uses; the vault
    // plugin receives vault:dispatch even though it is not the agent.
    let sent = tractor.deliver("vault:dispatch", None, Some(dispatch_payload()));
    assert_eq!(sent, 1, "the router must deliver vault:dispatch to 1 subscriber");

    // The plugin ran on its own thread; poll the graph until its result lands.
    let mut records = Vec::new();
    for _ in 0..50 {
        records = tractor
            .sync
            .query_nodes("refarm:VaultRecord")
            .expect("query refarm:VaultRecord");
        if !records.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(
        !records.is_empty(),
        "the vault plugin must receive its OWN event via the router and store a node"
    );

    tractor.shutdown().await.expect("shutdown must succeed");
}

/// THE LIVE E2E — the whole operator loop through a RUNNING sidecar, HTTP to
/// graph, in one test. This is the "easy place to test anything, however complex":
/// boot the runtime, load the vault plugin, register it, stand the real HTTP
/// sidecar, then POST an effort (fn=extract) to /efforts exactly as
/// `refarm vault dispatch` does — and assert the vault plugin's node lands in the
/// graph. Every link in production form: HTTP -> sidecar dispatch_effort branch ->
/// router deliver by subscription -> plugin on-event -> store-node.
#[tokio::test]
#[ignore = "requires vault-surface-ref build:plugin; run with --ignored"]
async fn operator_loop_http_to_graph_through_the_live_sidecar() {
    let path = wasm_path();
    if !path.exists() {
        eprintln!("SKIP: vault_plugin.wasm not found — run: pnpm --filter @refarm.dev/vault-surface-ref run build:plugin");
        return;
    }

    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");
    let handle = tractor.load_plugin(path).await.expect("vault plugin loads");
    tractor.register_for_events(handle);

    // Stand the REAL HTTP sidecar over this runtime's channels + router.
    let base_dir = std::env::temp_dir().join(format!(
        "tractor-e2e-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let state = tractor::sidecar::SidecarState::new(
        tractor.agent_channels.clone(),
        tractor.active_agent_id.clone(),
        tractor.event_router.clone(),
        tractor.telemetry.clone(),
        &base_dir,
        ":memory:".to_string(),
    )
    .expect("sidecar state");

    // Pick a free port, then hand it to the sidecar.
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        p
    };
    tokio::spawn(async move {
        let _ = tractor::sidecar::start(state, "127.0.0.1".to_string(), port).await;
    });
    // Wait for the listener to come up.
    for _ in 0..50 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    // POST the effort exactly as `refarm vault dispatch extract <note>` builds it.
    let effort = serde_json::json!({
        "id": "e2e-effort-1",
        "direction": "dispatch",
        "tasks": [{
            "id": "e2e-task-1",
            "pluginId": "vault",
            "fn": "extract",
            "args": {
                "note": {
                    "path": "20-Projects/demanda-42.md",
                    "text": "---\ntitle: Demanda 42\nstate: doing\n---\n\nbody #project\n"
                },
                "profile": {
                    "name": "p",
                    "rules": [{
                        "id": "extract-frontmatter",
                        "verb": "extract",
                        "match": "{\"type\":\"frontmatter\",\"recordType\":\"refarm:VaultRecord\"}"
                    }]
                },
                "replyRef": "e2e-effort-1"
            }
        }],
        "source": "refarm-vault-dispatch",
        "submittedAt": "2026-01-01T00:00:00Z"
    });
    let client = reqwest::Client::new();
    let res = client
        .post(format!("http://127.0.0.1:{port}/efforts"))
        .json(&effort)
        .send()
        .await
        .expect("POST /efforts");
    assert_eq!(res.status(), 200, "the sidecar accepts the dispatch effort");

    // The vault plugin ran on its thread; poll the SAME graph the plugin wrote to
    // (the plugin's store-node goes to tractor.sync, which we query directly).
    let mut results = Vec::new();
    for _ in 0..100 {
        results = tractor
            .sync
            .query_nodes("refarm:DispatchResult")
            .expect("query refarm:DispatchResult");
        if !results.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(
        !results.is_empty(),
        "the whole loop must land a dispatch-result node in the graph: HTTP -> sidecar -> router -> plugin -> store-node"
    );
    let node: serde_json::Value =
        serde_json::from_str(&results[0].payload).expect("result node JSON");
    assert_eq!(
        node["refarm:replyRef"], "e2e-effort-1",
        "the node correlates back to the effort by replyRef"
    );

    tractor.shutdown().await.expect("shutdown");
}
