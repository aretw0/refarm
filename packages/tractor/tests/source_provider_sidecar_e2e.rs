//! The LIVE loop: a WASM source provider served over the REAL HTTP sidecar.
//!
//! Every other proof of the sync-respond path stops short of the wire — the harness
//! calls handle.call_respond in-process; the TS adapter tests inject a fake channel.
//! This test closes the loop end to end: it boots the full TractorNative, loads the
//! real source_provider.wasm, registers it, stands up the sidecar HTTP server, and
//! POSTs to /plugins/:id/respond over an actual TCP socket — exactly what the TS
//! createWasmSourceProvider adapter does. The reply is the provider's catalog, read in
//! the response body: no effort id, no polling.
//!
//! # Requires
//!   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
//!
//! # Run
//!   cargo test --test source_provider_sidecar_e2e -- --ignored --test-threads=1

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tractor::trust::SecurityMode;
use tractor::{TractorNative, TractorNativeConfig};

static WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

fn wasm_path() -> &'static Path {
    WASM_PATH.get_or_init(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../source-provider-ref/dist/source_provider.wasm")
    })
}

fn memory_config_none() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..TractorNativeConfig::default()
    }
}

/// Build a SidecarState from a booted TractorNative (mirrors main.rs) and start it on
/// an OS-assigned port. Returns the port.
async fn start_sidecar(tractor: &TractorNative, base_dir: &Path) -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener); // sidecar::start binds its own; we only wanted a free port.

    let state = tractor::sidecar::SidecarState::new(
        tractor.plugin_channels.clone(),
        tractor.cancel_flags.clone(),
        tractor.in_flight_cancels.clone(),
        tractor.default_responder_id.clone(),
        tractor.event_router.clone(),
        tractor.telemetry.clone(),
        base_dir,
        "e2e".to_string(),
    )
    .expect("sidecar state")
    .with_registry(tractor.plugin_registry.clone());

    let auth_base = base_dir.to_path_buf();
    tokio::spawn(async move {
        // Loopback bind: no `surfaces.sidecar-http` declaration needed (S1's default),
        // so `None` is the correct/honest value for `declared_surface`, not a stand-in
        // for a real one. `Some("127.0.0.1")` for `host` is this harness explicitly
        // asserting loopback, mirroring an operator who passed `--http-host 127.0.0.1`.
        // No declared `device-token` gate and (normally) no REFARM_AUTH_POLICY ⇒ no
        // policy is resolvable ⇒ no auth layer, which is what this harness wants.
        let _ = tractor::sidecar::start(
            state,
            Some("127.0.0.1".to_string()),
            port,
            None,
            tractor::sidecar::ResolvedAuthPolicy::resolve(
                &tractor::sidecar::AuthPolicySource::new(auth_base, false),
            ),
        )
        .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    port
}

#[tokio::test]
#[ignore = "requires source-provider-ref build:plugin; run with --ignored"]
async fn wasm_source_provider_discover_over_the_sidecar() {
    let path = wasm_path();
    if !path.exists() {
        eprintln!(
            "SKIP: source_provider.wasm not found at {} — run: pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
            path.display()
        );
        return;
    }

    // Boot the real runtime, load + register the source provider plugin.
    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");
    let handle = tractor
        .load_plugin(path)
        .await
        .expect("source provider plugin must load");
    let plugin_id = handle.id.clone();
    // It declared its verbs synchronous (capabilities.syncVerbs).
    assert!(
        handle.sync_verbs.iter().any(|v| v == "source:discover"),
        "the plugin manifest must declare syncVerbs:[source:discover, …]"
    );
    tractor.register_for_events(handle);

    let tmp = std::env::temp_dir().join(format!("reqbench-e2e-{plugin_id}").replace('/', "-"));
    let port = start_sidecar(&tractor, &tmp).await;

    // POST /plugins/:id/respond — exactly the request createWasmSourceProvider makes.
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/plugins/{plugin_id}/respond");
    let res = client
        .post(&url)
        .json(&serde_json::json!({
            "verb": "source:discover",
            "payload": serde_json::json!({ "method": "discover" }).to_string(),
        }))
        .send()
        .await
        .expect("POST /plugins/:id/respond");
    assert_eq!(res.status(), 200, "the sync respond route must answer 200");

    let body: serde_json::Value = res.json().await.expect("json body");
    assert_eq!(body["ok"], true, "the respond must succeed: {body}");
    // The reply is the provider's catalog JSON string — parse + assert its contents.
    let reply: serde_json::Value =
        serde_json::from_str(body["reply"].as_str().expect("reply is a string"))
            .expect("reply parses as JSON");
    let entries = reply["entries"].as_array().expect("catalog entries[]");
    assert_eq!(entries.len(), 2, "the provider advertises two sources");
    assert_eq!(entries[0]["ref"], "wasm:sample-system-a");

    // The negotiated-sync GUARD: a verb the plugin did NOT declare sync is refused
    // cleanly (not-supported), never dispatched.
    let denied = client
        .post(&url)
        .json(&serde_json::json!({ "verb": "source:materialize", "payload": "{}" }))
        .send()
        .await
        .expect("POST for an undeclared sync verb");
    let denied_body: serde_json::Value = denied.json().await.unwrap();
    assert_eq!(denied_body["ok"], false);
    assert_eq!(denied_body["error"], "not-supported");
}
