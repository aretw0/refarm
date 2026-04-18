/// Pi-agent integration harness — "let the plugin be the plugin."
///
/// Runs the real pi_agent.wasm via PluginHost. Only the LLM HTTP boundary is
/// mocked: a local TCP server returns pre-scripted OpenAI-compat JSON so tests
/// are deterministic without real API keys.
///
/// # Requires
///   cargo component build --release   (in packages/pi-agent)
///
/// # Run
///   cargo test --test pi_agent_harness -- --ignored --test-threads=1
///
/// # Design note
///   env vars set via std::env::set_var propagate to the WASM plugin because
///   PluginHost uses WasiCtxBuilder::inherit_env(). Env vars are process-global,
///   so tests acquire ENV_LOCK before mutating them to prevent cross-test leakage.
use std::path::Path;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

/// Serializes env var mutations across all harness tests.
static ENV_LOCK: Mutex<()> = Mutex::new(());

const PI_AGENT_WASM: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../pi-agent/target/wasm32-wasip1/release/pi_agent.wasm",
);

/// Spawn a one-shot mock server that returns `body` for any HTTP POST.
/// Returns the bound port. The server accepts one connection then stops.
async fn mock_llm_server(body: serde_json::Value) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let body_str = body.to_string();
    tokio::spawn(async move {
        // Serve connections until the test is done (task is dropped).
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = vec![0u8; 8192];
            let _ = stream.read(&mut buf).await;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body_str.len(),
                body_str
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });
    port
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

fn wasm_path() -> &'static Path {
    Path::new(PI_AGENT_WASM)
}

/// Build a scripted OpenAI-compat completion response (Ollama wire format).
fn openai_response(content: &str, tokens_in: u32, tokens_out: u32) -> serde_json::Value {
    serde_json::json!({
        "id": "harness-mock",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": tokens_in, "completion_tokens": tokens_out, "total_tokens": tokens_in + tokens_out}
    })
}

/// Clear all env vars touched by the harness to prevent cross-test leakage.
fn clean_llm_env() {
    for var in ["LLM_PROVIDER","LLM_BASE_URL","LLM_MODEL","LLM_HISTORY_TURNS",
                "LLM_MAX_CONTEXT_TOKENS","LLM_FALLBACK_PROVIDER",
                "LLM_BUDGET_OLLAMA_USD","LLM_BUDGET_ANTHROPIC_USD","LLM_BUDGET_OPENAI_USD",
                "LLM_TOOL_CALL_MAX_ITER"] {
        std::env::remove_var(var);
    }
}

// ── Core harness tests ────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/pi-agent"]
async fn harness_agent_response_stored_in_crdt() {
    let _env = ENV_LOCK.lock().unwrap();
    let path = wasm_path();
    assert!(path.exists(), "pi_agent.wasm not found — run: cargo component build --release");

    clean_llm_env();
    let port = mock_llm_server(openai_response("Olá do harness!", 12, 6)).await;
    std::env::set_var("LLM_PROVIDER", "ollama");
    std::env::set_var("LLM_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100)).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load pi-agent");

    handle.call_on_event("user:prompt", Some("oi")).await.expect("on_event");

    let nodes = sync.query_nodes("AgentResponse").expect("query AgentResponse");
    assert!(!nodes.is_empty(), "AgentResponse must be stored after on_event");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["@type"], "AgentResponse");
    assert_eq!(v["content"], "Olá do harness!");
    assert_eq!(v["is_final"], true);
    assert!(v["timestamp_ns"].as_u64().unwrap_or(0) > 0, "timestamp_ns must be set");

    clean_llm_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/pi-agent"]
async fn harness_usage_record_stored_with_tokens() {
    let _env = ENV_LOCK.lock().unwrap();
    let path = wasm_path();
    assert!(path.exists(), "pi_agent.wasm not found");

    clean_llm_env();
    let port = mock_llm_server(openai_response("resposta", 20, 10)).await;
    std::env::set_var("LLM_PROVIDER", "ollama");
    std::env::set_var("LLM_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100)).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load pi-agent");

    handle.call_on_event("user:prompt", Some("teste de uso")).await.expect("on_event");

    let nodes = sync.query_nodes("UsageRecord").expect("query UsageRecord");
    assert!(!nodes.is_empty(), "UsageRecord must be stored");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["@type"], "UsageRecord");
    assert_eq!(v["provider"], "ollama");
    assert_eq!(v["tokens_in"].as_u64().unwrap_or(0), 20);
    assert_eq!(v["tokens_out"].as_u64().unwrap_or(0), 10);
    assert_eq!(v["estimated_usd"].as_f64().unwrap_or(1.0), 0.0,
        "local/ollama models must have zero estimated cost");

    clean_llm_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/pi-agent"]
async fn harness_context_guard_blocks_oversized_prompt() {
    let _env = ENV_LOCK.lock().unwrap();
    let path = wasm_path();
    assert!(path.exists(), "pi_agent.wasm not found");

    clean_llm_env();
    std::env::set_var("LLM_MAX_CONTEXT_TOKENS", "1");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100)).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load pi-agent");

    handle
        .call_on_event("user:prompt", Some("este prompt tem tokens demais para o limite de 1"))
        .await
        .expect("on_event");

    let nodes = sync.query_nodes("AgentResponse").expect("query AgentResponse");
    assert!(!nodes.is_empty(), "blocked prompt must still produce AgentResponse");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let content = v["content"].as_str().unwrap_or("");
    assert!(content.contains("LLM_MAX_CONTEXT_TOKENS"),
        "blocked response must name the guard: {content}");

    clean_llm_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/pi-agent"]
async fn harness_budget_block_falls_through_to_error_without_fallback() {
    let _env = ENV_LOCK.lock().unwrap();
    let path = wasm_path();
    assert!(path.exists(), "pi_agent.wasm not found");

    clean_llm_env();
    std::env::set_var("LLM_BUDGET_OLLAMA_USD", "0.0");
    std::env::set_var("LLM_PROVIDER", "ollama");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100)).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load pi-agent");

    handle.call_on_event("user:prompt", Some("prompt bloqueado pelo budget")).await.expect("on_event");

    let nodes = sync.query_nodes("AgentResponse").expect("query AgentResponse");
    assert!(!nodes.is_empty(), "budget block must store AgentResponse with error");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let content = v["content"].as_str().unwrap_or("");
    assert!(content.contains("budget") || content.contains("erro"),
        "budget block content must describe the block: {content}");

    clean_llm_env();
}
