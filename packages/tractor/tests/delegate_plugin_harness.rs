//! Delegate plugin integration harness — agent-delegation ergonomics end to end.
//!
//! Proves the `@refarm.dev/delegate` plugin's single + chain modes on the REAL runtime:
//! the host loads the delegate component + the agent (with its dispatch manifest so
//! `agent:respond` is a dispatchable verb). Delivering a `delegate:dispatch` event drives
//! the delegate, which resolves a persona and calls the agent's `respond` via the real
//! `call_plugin` (cross-plugin: delegate → agent, the same SPI call-through the vault
//! harness proves). The agent runs a sub-turn against a mock LLM and its response rides
//! back through the delegate as a `DispatchResult` node.
//!
//! # Requires
//!   cargo component build --release          (in packages/agent → agent.wasm)
//!   pnpm --filter @refarm.dev/delegate run build:wasm   (→ dist/plugin.wasm, gitignored)
//!
//! # Run
//!   cargo test --test delegate_plugin_harness -- --ignored --test-threads=1

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tractor::{TractorNative, TractorNativeConfig};
use tractor::trust::SecurityMode;

static AGENT_WASM_PATH: OnceLock<PathBuf> = OnceLock::new();
static DELEGATE_WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The agent component (built by `cargo component build --release` in packages/agent).
/// Resolved via CARGO_TARGET_DIR like the agent harness, else the crate-relative target.
fn agent_wasm_path() -> &'static Path {
    AGENT_WASM_PATH.get_or_init(|| match std::env::var("CARGO_TARGET_DIR") {
        Ok(dir) => PathBuf::from(dir).join("wasm32-wasip1/release/agent.wasm"),
        Err(_) => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../agent/target/wasm32-wasip1/release/agent.wasm"),
    })
}

/// The delegate plugin component (built by `@refarm.dev/delegate` `build:wasm` → its own
/// dist/, gitignored). Beside the wasm sits its plugin.json declaring verbs.key
/// `delegate`, so loading from dist/ puts `delegate:single` / `delegate:chain` into the
/// registry.
fn delegate_wasm_path() -> &'static Path {
    DELEGATE_WASM_PATH
        .get_or_init(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../delegate/dist/plugin.wasm"))
}

/// Memory-only, security-off runtime — the untrusted agent + delegate must load (not the
/// default Strict gate). Mirrors vault_plugin_harness / agent_harness.
fn memory_config_none() -> TractorNativeConfig {
    TractorNativeConfig {
        namespace: ":memory:".to_string(),
        port: 0,
        security_mode: SecurityMode::None,
        ..TractorNativeConfig::default()
    }
}

/// Serialize env-mutating tests (MODEL_* is process-global).
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

fn clean_model_env() {
    for k in ["MODEL_PROVIDER", "MODEL_BASE_URL", "MODEL_SYSTEM", "MODEL_MODEL", "MODEL_SESSION_ID"] {
        std::env::remove_var(k);
    }
}

/// One-shot mock LLM: returns `content` (openai chat-completion shape) for any POST. Each
/// call to the server returns the same body — fine for these tests (each sub-turn is one
/// completion). Returns the bound port.
async fn mock_llm_server(content: &str) -> u16 {
    use std::convert::Infallible;
    let body = serde_json::json!({
        "id": "delegate-harness",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop"
        }],
        "usage": { "prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12 }
    })
    .to_string();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else { break };
            let body = body.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _: Result<(), Infallible> = {
                    let _ = stream.write_all(resp.as_bytes()).await;
                    let _ = stream.flush().await;
                    Ok(())
                };
            });
        }
    });
    port
}

/// Load the agent WITH its dispatch manifest (materialize agent.wasm + its plugin.json,
/// entry injected) so `agent:respond` is dispatchable — the delegate's call_plugin target.
async fn load_agent(tractor: &TractorNative) -> Option<String> {
    let wasm = agent_wasm_path();
    if !wasm.exists() {
        eprintln!("SKIP: agent.wasm not found — run: cargo component build --release in packages/agent");
        return None;
    }
    let manifest_src =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/plugin.json"))
            .expect("agent plugin.json reads");
    let mut manifest: serde_json::Value =
        serde_json::from_str(&manifest_src).expect("agent plugin.json is JSON");
    let obj = manifest.as_object_mut().unwrap();
    obj.remove("_note");
    obj.insert("entry".into(), serde_json::json!("plugin.wasm"));

    let dir = Box::leak(Box::new(tempfile::tempdir().expect("agent install dir")));
    std::fs::copy(wasm, dir.path().join("plugin.wasm")).expect("copy agent.wasm");
    std::fs::write(
        dir.path().join("plugin.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .expect("write agent plugin.json");

    let handle = tractor
        .load_plugin(&dir.path().join("plugin.wasm"))
        .await
        .expect("agent must load");
    let id = handle.id.clone();
    tractor.register_for_events(handle);
    Some(id)
}

/// Load the delegate plugin from its dist/ (plugin.json beside the wasm). Its setup seeds
/// the AgentPersona nodes; register_for_events puts `delegate:single`/`chain` +
/// `delegate:dispatch` into the registry. Returns None (skip) if not built.
async fn load_delegate(tractor: &TractorNative) -> Option<String> {
    let wasm = delegate_wasm_path();
    if !wasm.exists() {
        eprintln!(
            "SKIP: delegate plugin.wasm not found at {} — run: pnpm --filter @refarm.dev/delegate run build:wasm",
            wasm.display()
        );
        return None;
    }
    let handle = tractor.load_plugin(wasm).await.expect("delegate must load");
    let id = handle.id.clone();
    tractor.register_for_events(handle);
    Some(id)
}

/// Poll the graph for the delegate's `DispatchResult` node keyed by `reply_ref`.
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
    panic!("delegate never stored a DispatchResult for replyRef {reply_ref}");
}

/// Boot + load agent + delegate, sharing one mock LLM that answers `sub_agent_says`.
/// Returns the booted tractor (agent + delegate registered) or None (skip).
async fn boot_agent_and_delegate(sub_agent_says: &str) -> Option<TractorNative> {
    let port = mock_llm_server(sub_agent_says).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");
    load_agent(&tractor).await?;
    load_delegate(&tractor).await?;
    Some(tractor)
}

#[tokio::test]
#[ignore = "requires agent.wasm + delegate build:wasm; run with --ignored --test-threads=1"]
async fn harness_delegate_single_runs_a_persona_task_through_the_agent() {
    let _env = env_lock();
    clean_model_env();

    let Some(tractor) = boot_agent_and_delegate("scouted: the config lives in src/index.ts").await
    else {
        clean_model_env();
        return;
    };

    // Deliver a delegate:single dispatch by the router (the delegate subscribes to
    // delegate:dispatch). This is the same envelope the agent's invoke_tool would send.
    let payload = serde_json::json!({
        "verb": "single",
        "persona": "scout",
        "task": "find where the config lives",
        "replyRef": "delegate-single-1"
    })
    .to_string();
    let sent = tractor.deliver("delegate:dispatch", None, Some(payload));
    assert_eq!(sent, 1, "the router must deliver delegate:dispatch to the delegate");

    let node = await_dispatch_result(&tractor, "delegate-single-1").await;
    assert_eq!(node["@type"], "DispatchResult");
    // The delegate returns the sub-agent's content under result.content.
    assert_eq!(
        node["result"]["content"], "scouted: the config lives in src/index.ts",
        "the scout sub-agent's response must ride back through the delegate: {node}"
    );

    tractor.shutdown().await.expect("shutdown");
    clean_model_env();
}

#[tokio::test]
#[ignore = "requires agent.wasm + delegate build:wasm; run with --ignored --test-threads=1"]
async fn harness_delegate_chain_threads_persona_steps_through_the_agent() {
    let _env = env_lock();
    clean_model_env();

    // Every sub-turn hits the same mock, so each step's sub-agent returns this string.
    // The chain's VALUE here is proving the plumbing: N sequential sub-turns, each result
    // threaded into the next step, one final DispatchResult.
    let Some(tractor) = boot_agent_and_delegate("step done").await else {
        clean_model_env();
        return;
    };

    let payload = serde_json::json!({
        "verb": "chain",
        "steps": [
            { "persona": "scout",   "task": "recon the task" },
            { "persona": "planner", "task": "plan from: {previous}" },
            { "persona": "worker",  "task": "execute the plan" }
        ],
        "replyRef": "delegate-chain-1"
    })
    .to_string();
    let sent = tractor.deliver("delegate:dispatch", None, Some(payload));
    assert_eq!(sent, 1, "the router must deliver delegate:dispatch to the delegate");

    let node = await_dispatch_result(&tractor, "delegate-chain-1").await;
    assert_eq!(node["@type"], "DispatchResult");
    // The chain returns the FINAL step's content (all three ran sequentially).
    assert_eq!(
        node["result"]["content"], "step done",
        "the chain must return the final sub-agent step's response: {node}"
    );

    tractor.shutdown().await.expect("shutdown");
    clean_model_env();
}

#[tokio::test]
#[ignore = "requires delegate build:wasm; run with --ignored --test-threads=1"]
async fn harness_delegate_setup_seeds_the_default_agent_personas() {
    let _env = env_lock();
    clean_model_env();

    let tractor = TractorNative::boot(memory_config_none())
        .await
        .expect("boot must succeed");
    // Loading the delegate runs its setup(), which seeds the default personas as
    // AgentPersona graph nodes (idempotent).
    let Some(_id) = load_delegate(&tractor).await else {
        clean_model_env();
        return;
    };

    // Give setup() a beat to store the nodes (it runs on the plugin's runner thread).
    let mut personas: Vec<serde_json::Value> = Vec::new();
    for _ in 0..100 {
        let rows = tractor.sync.query_nodes("AgentPersona").expect("query AgentPersona");
        if rows.len() >= 4 {
            personas = rows
                .iter()
                .filter_map(|r| serde_json::from_str::<serde_json::Value>(&r.payload).ok())
                .collect();
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let names: std::collections::BTreeSet<String> = personas
        .iter()
        .filter_map(|p| p["name"].as_str().map(|s| s.to_string()))
        .collect();
    for expected in ["scout", "planner", "worker", "reviewer"] {
        assert!(
            names.contains(expected),
            "setup must seed the '{expected}' AgentPersona node; got {names:?}"
        );
    }
    // Each seeded persona carries a non-empty system prompt (the persona itself).
    for p in &personas {
        assert!(
            !p["system"].as_str().unwrap_or("").is_empty(),
            "each AgentPersona must carry a system prompt: {p}"
        );
    }

    tractor.shutdown().await.expect("shutdown");
    clean_model_env();
}
