use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
/// Pi-agent integration harness — "let the plugin be the plugin."
///
/// Runs the real agent.wasm via PluginHost. Only the LLM HTTP boundary is
/// mocked: a local TCP server returns pre-scripted OpenAI-compat JSON so tests
/// are deterministic without real API keys.
///
/// # Requires
///   cargo component build --release   (in packages/agent)
///
/// # Run
///   cargo test --test agent_harness -- --ignored --test-threads=1
///
/// # Design note
///   env vars set via std::env::set_var propagate to the WASM plugin because
///   PluginHost uses WasiCtxBuilder::inherit_env(). Env vars are process-global,
///   so tests acquire ENV_LOCK before mutating them to prevent cross-test leakage.
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tractor::host::{PluginHost, PluginInstanceHandle};
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

/// Serializes env var mutations across all harness tests.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Acquire the env serializer, ignoring poison. The lock guards a `()` — it
/// orders env-var access, it does not protect an invariant, so a prior test that
/// panicked while holding it left NOTHING inconsistent. Recovering the guard
/// (instead of `.unwrap()`) stops one genuine failure from cascading into a wall
/// of false `PoisonError`s across every later test, which masks the real cause.
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

static WASM_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Resolve agent.wasm location at runtime so CARGO_TARGET_DIR redirects work.
/// When CARGO_TARGET_DIR is set (e.g. devcontainer volume), all cargo outputs land
/// there instead of each package's own target/ subdirectory.
fn wasm_path() -> &'static Path {
    WASM_PATH.get_or_init(|| match std::env::var("CARGO_TARGET_DIR") {
        Ok(dir) => PathBuf::from(dir).join("wasm32-wasip1/release/agent.wasm"),
        Err(_) => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../agent/target/wasm32-wasip1/release/agent.wasm"),
    })
}

/// Spawn a one-shot mock server that returns `body` for any HTTP POST.
/// Returns the bound port. The server accepts one connection then stops.
async fn mock_llm_server(body: serde_json::Value) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let body_str = body.to_string();
    std::thread::spawn(move || {
        // Serve connections until the test is done (task is dropped).
        while let Ok((mut stream, _)) = listener.accept() {
            let _ = read_http_request(&mut stream);
            let _ = write_http_response(&mut stream, &body_str);
        }
    });
    port
}

fn make_sync() -> NativeSync {
    let storage = NativeStorage::open(":memory:").unwrap();
    NativeSync::new(storage, ":memory:").unwrap()
}

async fn call_on_event_with_timeout(
    handle: &mut PluginInstanceHandle,
    payload: &str,
    context: &str,
) {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        handle.call_on_event("user:prompt", Some(payload)),
    )
    .await
    .unwrap_or_else(|_| panic!("{context} timed out in call_on_event"))
    .unwrap_or_else(|err| panic!("{context} on_event failed: {err}"));
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

/// Serve a sequence of responses in order; repeats the last one once exhausted.
async fn mock_llm_server_sequence(bodies: Vec<serde_json::Value>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let strings: Vec<String> = bodies.iter().map(|v| v.to_string()).collect();
    std::thread::spawn(move || {
        let mut idx = 0usize;
        while let Ok((mut stream, _)) = listener.accept() {
            let body = strings.get(idx).or_else(|| strings.last()).unwrap().clone();
            idx = (idx + 1).min(strings.len().saturating_sub(1) + 1);
            let _ = read_http_request(&mut stream);
            let _ = write_http_response(&mut stream, &body);
        }
    });
    port
}

/// Serve responses in sequence AND send each parsed JSON request body to a channel.
/// Lets tests inspect what the plugin sent to the mock LLM.
async fn mock_llm_server_capturing(
    bodies: Vec<serde_json::Value>,
) -> (u16, tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let strings: Vec<String> = bodies.iter().map(|v| v.to_string()).collect();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        let mut idx = 0usize;
        while let Ok((mut stream, _)) = listener.accept() {
            let body = strings.get(idx).or_else(|| strings.last()).unwrap().clone();
            idx = (idx + 1).min(strings.len().saturating_sub(1) + 1);
            // Extract JSON body that follows the HTTP header separator.
            if let Ok(buf) = read_http_request(&mut stream) {
                if let Some(sep) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    if let Ok(v) = serde_json::from_slice(&buf[sep + 4..]) {
                        let _ = tx.send(v);
                    }
                }
            }
            let _ = write_http_response(&mut stream, &body);
        }
    });
    (port, rx)
}

/// Serve a deterministic SSE response and capture the provider request body.
async fn mock_sse_llm_server_capturing(
    body: &'static str,
) -> (u16, tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>) {
    mock_sse_llm_server_sequence_capturing(vec![body]).await
}

async fn mock_sse_llm_server_sequence_capturing(
    bodies: Vec<&'static str>,
) -> (u16, tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        let mut idx = 0usize;
        while let Ok((mut stream, _)) = listener.accept() {
            let body = bodies
                .get(idx)
                .or_else(|| bodies.last())
                .copied()
                .unwrap_or("");
            idx = (idx + 1).min(bodies.len().saturating_sub(1) + 1);
            if let Ok(buf) = read_http_request(&mut stream) {
                if let Some(sep) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    if let Ok(v) = serde_json::from_slice(&buf[sep + 4..]) {
                        let _ = tx.send(v);
                    }
                }
            }
            let _ = write_sse_http_response(&mut stream, body);
        }
    });
    (port, rx)
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let n = stream.read(&mut tmp)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if request_body_complete(&buf) {
            break;
        }
    }
    Ok(buf)
}

fn request_body_complete(buf: &[u8]) -> bool {
    let Some(sep) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&buf[..sep]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    buf.len() >= sep + 4 + content_length
}

fn write_http_response(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

fn write_sse_http_response(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

/// Clear all env vars touched by the harness to prevent cross-test leakage.
/// The agent guest reads the MODEL_* vocabulary (the LLM_* aliases were dropped
/// as pre-release dead compat); these are the names the agent actually consumes.
fn clean_model_env() {
    for var in [
        "MODEL_PROVIDER",
        "MODEL_BASE_URL",
        "MODEL_ID",
        "MODEL_HISTORY_TURNS",
        "MODEL_FS_ROOT",
        "MODEL_SHELL_ALLOWLIST",
        "MODEL_MAX_CONTEXT_TOKENS",
        "MODEL_FALLBACK_PROVIDER",
        "MODEL_BUDGET_OLLAMA_USD",
        "MODEL_BUDGET_ANTHROPIC_USD",
        "MODEL_BUDGET_OPENAI_USD",
        "MODEL_TOOL_CALL_MAX_ITER",
        "MODEL_TOOL_OUTPUT_MAX_LINES",
        "MODEL_STREAM_RESPONSES",
        "MODEL_SYSTEM",
        "MODEL_AGENT_ID",
        "MODEL_SESSION_ID",
        "MODEL_TASK_MEMORY",
        "REFACTOR_LSP_CMD",
        "REFACTOR_LSP_RUST_ANALYZER_CMD",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
    ] {
        std::env::remove_var(var);
    }
}

fn python3_is_available_for_harness() -> bool {
    std::process::Command::new("python3")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

const FAKE_LSP_CODE_OPS_SERVER: &str = r#"
import json
import sys

def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line == b'\r\n':
            break
        name, value = line.decode('ascii').split(':', 1)
        headers[name.lower()] = value.strip()
    body = sys.stdin.buffer.read(int(headers['content-length']))
    return json.loads(body)

def send(message):
    body = json.dumps(message, separators=(',', ':')).encode('utf-8')
    sys.stdout.buffer.write(b'Content-Length: ' + str(len(body)).encode('ascii') + b'\r\n\r\n' + body)
    sys.stdout.buffer.flush()

while True:
    message = read_message()
    if message is None:
        break
    method = message.get('method')
    if method == 'initialize':
        send({'jsonrpc': '2.0', 'id': message['id'], 'result': {'capabilities': {}}})
    elif method == 'textDocument/references':
        uri = message['params']['textDocument']['uri']
        send({
            'jsonrpc': '2.0',
            'id': message['id'],
            'result': [
                {
                    'uri': uri,
                    'range': {
                        'start': {'line': 0, 'character': 4},
                        'end': {'line': 0, 'character': 7},
                    },
                },
                {
                    'uri': uri,
                    'range': {
                        'start': {'line': 0, 'character': 10},
                        'end': {'line': 0, 'character': 13},
                    },
                },
            ],
        })
    elif method == 'textDocument/rename':
        uri = message['params']['textDocument']['uri']
        new_name = message['params']['newName']
        send({
            'jsonrpc': '2.0',
            'id': message['id'],
            'result': {
                'changes': {
                    uri: [
                        {
                            'range': {
                                'start': {'line': 0, 'character': 4},
                                'end': {'line': 0, 'character': 7},
                            },
                            'newText': new_name,
                        },
                        {
                            'range': {
                                'start': {'line': 0, 'character': 10},
                                'end': {'line': 0, 'character': 13},
                            },
                            'newText': new_name,
                        },
                    ],
                },
            },
        })
"#;

// ── Core harness tests ────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_agent_response_stored_in_crdt() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(
        path.exists(),
        "agent.wasm not found — run: cargo component build --release"
    );

    clean_model_env();
    let port = mock_llm_server(openai_response("Olá do harness!", 12, 6)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "oi", "agent response harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(
        !nodes.is_empty(),
        "AgentResponse must be stored after on_event"
    );

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["@type"], "Response");
    assert_eq!(v["content"], "Olá do harness!");
    assert_eq!(v["is_final"], true);
    assert!(
        v["timestamp_ns"].as_u64().unwrap_or(0) > 0,
        "timestamp_ns must be set"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_prompt_task_lifecycle_recorded_in_crdt() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(
        path.exists(),
        "agent.wasm not found — run: cargo component build --release"
    );

    clean_model_env();
    let port = mock_llm_server(openai_response("task lifecycle ok", 14, 7)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "check task recording",
        "task lifecycle harness",
    )
    .await;

    // ── Task node ─────────────────────────────────────────────────────────────
    let task_nodes = sync.query_nodes("Task").expect("query Task");
    assert_eq!(
        task_nodes.len(),
        1,
        "exactly one Task node must be stored per prompt"
    );

    let task: serde_json::Value = serde_json::from_str(&task_nodes[0].payload).unwrap();
    assert_eq!(task["@type"], "Task", "@type must be Task");
    assert!(
        task["@id"]
            .as_str()
            .unwrap_or("")
            .starts_with("urn:refarm:task:v1:"),
        "@id must follow task URN scheme, got: {}",
        task["@id"]
    );
    assert_eq!(
        task["status"], "done",
        "task must be closed as done after a normal LLM response"
    );
    assert_eq!(
        task["title"], "check task recording",
        "title must be first line of prompt"
    );
    assert!(
        task["context_id"]
            .as_str()
            .unwrap_or("")
            .starts_with("urn:refarm:session"),
        "context_id must reference the session URN, got: {}",
        task["context_id"]
    );
    assert_eq!(
        task["assigned_to"], "urn:refarm:agent:runtime-agent",
        "assigned_to must default to runtime-agent actor URN when MODEL_AGENT_ID is unset"
    );

    // ── TaskEvent nodes ───────────────────────────────────────────────────────
    let event_nodes = sync.query_nodes("TaskEvent").expect("query TaskEvent");
    assert_eq!(
        event_nodes.len(),
        2,
        "exactly two TaskEvents expected: created + status_changed"
    );

    let events: Vec<serde_json::Value> = event_nodes
        .iter()
        .map(|n| serde_json::from_str::<serde_json::Value>(&n.payload).unwrap())
        .collect();

    let task_id = task["@id"].as_str().unwrap();

    let created = events
        .iter()
        .find(|e| e["event"] == "created")
        .expect("TaskEvent with event=created not found");
    assert_eq!(created["@type"], "TaskEvent");
    assert_eq!(
        created["task_id"], task_id,
        "created event must reference the Task"
    );
    assert_eq!(created["payload"]["source"], "agent.respond");

    let closed = events
        .iter()
        .find(|e| e["event"] == "status_changed")
        .expect("TaskEvent with event=status_changed not found");
    assert_eq!(
        closed["task_id"], task_id,
        "status_changed event must reference the Task"
    );
    assert_eq!(closed["payload"]["status"], "done");
    assert_eq!(
        closed["payload"]["tokens_in"].as_u64().unwrap_or(0),
        14,
        "tokens_in must match mock LLM response"
    );
    assert_eq!(
        closed["payload"]["tokens_out"].as_u64().unwrap_or(0),
        7,
        "tokens_out must match mock LLM response"
    );
    assert!(
        !closed["payload"]["model"].as_str().unwrap_or("").is_empty(),
        "model must be recorded in the closing event"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_task_memory_disabled_stores_no_task_nodes() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(
        path.exists(),
        "agent.wasm not found — run: cargo component build --release"
    );

    clean_model_env();
    let port = mock_llm_server(openai_response("reply when task memory is off", 8, 4)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_TASK_MEMORY", "0");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "prompt with task memory off",
        "task memory disabled harness",
    )
    .await;

    // AgentResponse must still be stored — only the Task/TaskEvent layer is skipped.
    let responses = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(
        !responses.is_empty(),
        "AgentResponse must still be stored regardless of MODEL_TASK_MEMORY"
    );

    let tasks = sync.query_nodes("Task").expect("query Task");
    assert!(
        tasks.is_empty(),
        "no Task nodes must be stored when MODEL_TASK_MEMORY=0"
    );

    let events = sync.query_nodes("TaskEvent").expect("query TaskEvent");
    assert!(
        events.is_empty(),
        "no TaskEvent nodes must be stored when MODEL_TASK_MEMORY=0"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_streaming_opt_in_stores_partials_and_final_response() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(
        path.exists(),
        "agent.wasm not found — run: cargo component build --release"
    );

    clean_model_env();
    let (port, mut requests) = mock_sse_llm_server_capturing(
        r#"data: {"choices":[{"delta":{"content":"Olá "}}]}

data: {"choices":[{"delta":{"content":"stream"}}]}

data: {"choices":[],"usage":{"prompt_tokens":13,"completion_tokens":5,"total_tokens":18}}

data: [DONE]

"#,
    )
    .await;
    let streams_dir = tempfile::tempdir().unwrap();
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_STREAM_RESPONSES", "1");
    std::env::set_var("REFARM_STREAMS_DIR", streams_dir.path());

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "oi", "streaming harness").await;

    let request = requests.recv().await.expect("captured provider request");
    assert_eq!(request["stream"], true);

    let mut payloads: Vec<serde_json::Value> = sync
        .query_nodes("Response")
        .expect("query AgentResponse")
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    payloads.sort_by_key(|payload| payload["sequence"].as_u64().unwrap_or(u64::MAX));

    assert_eq!(payloads.len(), 3, "two partial chunks plus final response");
    assert_eq!(payloads[0]["content"], "Olá ");
    assert_eq!(payloads[0]["is_final"], false);
    assert_eq!(payloads[0]["sequence"], 0);
    assert_eq!(payloads[1]["content"], "stream");
    assert_eq!(payloads[1]["is_final"], false);
    assert_eq!(payloads[1]["sequence"], 1);
    assert_eq!(payloads[2]["content"], "Olá stream");
    assert_eq!(payloads[2]["is_final"], true);
    assert_eq!(payloads[2]["sequence"], 2);

    let mut stream_chunks: Vec<serde_json::Value> = sync
        .query_nodes("StreamChunk")
        .expect("query StreamChunk")
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    stream_chunks.sort_by_key(|payload| payload["sequence"].as_u64().unwrap_or(u64::MAX));
    assert_eq!(
        stream_chunks.len(),
        3,
        "two partial chunks plus final marker"
    );
    assert_eq!(stream_chunks[0]["content"], "Olá ");
    assert_eq!(stream_chunks[0]["is_final"], false);
    assert_eq!(stream_chunks[1]["content"], "stream");
    assert_eq!(stream_chunks[1]["is_final"], false);
    assert_eq!(stream_chunks[2]["content"], "Olá stream");
    assert_eq!(stream_chunks[2]["payload_kind"], "final_text");
    assert_eq!(stream_chunks[2]["is_final"], true);

    let stream_sessions = sync
        .query_nodes("StreamSession")
        .expect("query StreamSession");
    assert_eq!(stream_sessions.len(), 1);
    let session: serde_json::Value = serde_json::from_str(&stream_sessions[0].payload).unwrap();
    assert_eq!(session["stream_kind"], "response");
    assert_eq!(session["status"], "completed");
    assert_eq!(session["last_sequence"], 2);
    assert_eq!(session["chunk_count"], 3);
    assert_eq!(session["metadata"]["projection"], "Response");

    let usage_records = sync.query_nodes("UsageRecord").expect("query UsageRecord");
    assert_eq!(
        usage_records.len(),
        1,
        "streaming final body should preserve usage"
    );
    let usage: serde_json::Value = serde_json::from_str(&usage_records[0].payload).unwrap();
    assert_eq!(usage["tokens_in"], 13);
    assert_eq!(usage["tokens_out"], 5);

    // The ndjson spine the CLI actually tails: the HOST wrote each delta as an
    // is_final:false partial line (Slice B), and the GUEST wrote the single final
    // line as an empty end-marker because partials preceded it (Slice A). So the
    // CLI's `content += chunk.content` over the file reconstructs the whole answer
    // EXACTLY ONCE, with exactly one is_final line.
    // Resolve the single ndjson file in the isolated streams dir (its name carries
    // the derived prompt_ref, not the raw prompt, so discover it by extension).
    let ndjson_path = std::fs::read_dir(streams_dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().map(|x| x == "ndjson").unwrap_or(false))
        .expect("host+guest must write an agent-response ndjson stream");
    assert!(
        ndjson_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("urn:tractor:stream:response:"),
        "stream file is named by the agent-response stream_ref"
    );
    let ndjson = std::fs::read_to_string(&ndjson_path).unwrap();
    let lines: Vec<serde_json::Value> = ndjson
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();

    let final_count = lines.iter().filter(|l| l["is_final"] == true).count();
    assert_eq!(final_count, 1, "exactly one is_final line");
    assert!(lines.len() > 1, "incremental: more than just the final line");

    let final_line = lines.iter().find(|l| l["is_final"] == true).unwrap();
    assert_eq!(
        final_line["content"], "",
        "final is an empty end-marker when partials preceded it"
    );

    let reconstructed: String = lines
        .iter()
        .filter_map(|l| l["content"].as_str())
        .collect();
    assert_eq!(
        reconstructed, "Olá stream",
        "content += over the ndjson file yields the whole answer exactly once"
    );

    clean_model_env();
    std::env::remove_var("REFARM_STREAMS_DIR");
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_streaming_tool_call_round_trip_still_completes() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(
        path.exists(),
        "agent.wasm not found — run: cargo component build --release"
    );

    clean_model_env();
    let (port, mut requests) = mock_sse_llm_server_sequence_capturing(vec![
        r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_echo","type":"function","function":{"name":"bash","arguments":"{\"argv\":[\"echo\","}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"stream-tool\"]}"}}]}}]}

data: [DONE]

"#,
        r#"data: {"choices":[{"delta":{"content":"tool streamed"}}]}

data: [DONE]

"#,
    ])
    .await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_STREAM_RESPONSES", "1");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "run echo", "streaming tool harness").await;

    let first_request = requests
        .recv()
        .await
        .expect("captured first provider request");
    let second_request = requests
        .recv()
        .await
        .expect("captured second provider request");
    assert_eq!(first_request["stream"], true);
    assert_eq!(second_request["stream"], true);

    let responses = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    let final_response: serde_json::Value = responses
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .find(|payload: &serde_json::Value| payload["is_final"] == true)
        .expect("final response");
    assert_eq!(final_response["content"], "tool streamed");
    assert_eq!(final_response["sequence"], 1);
    assert_eq!(final_response["tool_calls"][0]["name"], "bash");

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_usage_record_stored_with_tokens() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();
    let port = mock_llm_server(openai_response("resposta", 20, 10)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "teste de uso", "usage record harness").await;

    let nodes = sync.query_nodes("UsageRecord").expect("query UsageRecord");
    assert!(!nodes.is_empty(), "UsageRecord must be stored");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["@type"], "UsageRecord");
    assert_eq!(v["provider"], "ollama");
    assert_eq!(v["tokens_in"].as_u64().unwrap_or(0), 20);
    assert_eq!(v["tokens_out"].as_u64().unwrap_or(0), 10);
    assert_eq!(
        v["estimated_usd"].as_f64().unwrap_or(1.0),
        0.0,
        "local/ollama models must have zero estimated cost"
    );

    clean_model_env();
}

/// #6 promptSnippet Slice 1 — a dispatchable plugin's usage guidance reaches the
/// system prompt sent to the provider. Wires a registry (via with_cross_plugin)
/// with a mock `vault` plugin declaring `vault:store` guarded by `vault:dispatch`,
/// then drives the real agent.wasm and asserts the captured request's `system`
/// carries the `vault_store` guidance line the host synthesizes.
#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_plugin_tool_guidance_reaches_system_prompt() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();
    let (port, mut requests) =
        mock_llm_server_capturing(vec![openai_response("ok", 4, 2)]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    // A registry with one dispatchable plugin — the agent leg's list-tool-prompts
    // reads this at prompt-build time.
    let registry = tractor::host::PluginRegistry::default();
    registry.register(
        "vault",
        vec!["vault:store".into(), "vault:dispatch".into()],
        vec!["vault:dispatch".into()],
    );
    let cross = tractor::host::CrossPluginAccess {
        registry,
        event_router: tractor::EventRouter::default(),
        plugin_channels: std::sync::Arc::new(std::sync::RwLock::new(
            std::collections::HashMap::new(),
        )),
    };

    let sync = make_sync();
    let host = PluginHost::new(
        TrustManager::new(),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .unwrap()
    .with_cross_plugin(cross);
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "oi", "plugin-tool guidance harness").await;

    let request = requests.recv().await.expect("captured provider request");
    // The system prompt is the `role:"system"` message (openai-compat) or the
    // top-level `system` field (anthropic); scan both so the assertion doesn't
    // depend on message ordering.
    let system_from_messages: String = request["messages"]
        .as_array()
        .map(|msgs| {
            msgs.iter()
                .filter(|m| m["role"] == "system")
                .filter_map(|m| m["content"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let system = if system_from_messages.is_empty() {
        request["system"].as_str().unwrap_or("").to_string()
    } else {
        system_from_messages
    };
    assert!(
        system.contains("vault_store"),
        "system prompt must carry the plugin tool's guidance line; got: {system}"
    );
    assert!(
        system.contains("vault"),
        "guidance names the target plugin; got: {system}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_context_guard_blocks_oversized_prompt() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();
    std::env::set_var("MODEL_MAX_CONTEXT_TOKENS", "1");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "este prompt tem tokens demais para o limite de 1",
        "context guard harness",
    )
    .await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(
        !nodes.is_empty(),
        "blocked prompt must still produce AgentResponse"
    );

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let content = v["content"].as_str().unwrap_or("");
    assert!(
        content.contains("MODEL_MAX_CONTEXT_TOKENS"),
        "blocked response must name the guard: {content}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_budget_block_falls_through_to_error_without_fallback() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();
    std::env::set_var("MODEL_BUDGET_OLLAMA_USD", "0.0");
    std::env::set_var("MODEL_PROVIDER", "ollama");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "prompt bloqueado pelo budget",
        "budget block harness",
    )
    .await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(
        !nodes.is_empty(),
        "budget block must store AgentResponse with error"
    );

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let content = v["content"].as_str().unwrap_or("");
    assert!(
        content.contains("budget") || content.contains("erro"),
        "budget block content must describe the block: {content}"
    );

    clean_model_env();
}

// ── Harness expansion ─────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_tool_use_dispatched_and_result_fed_back() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    // First LLM response: request a bash tool call (echo).
    // Second LLM response: final text after tool result is fed back.
    let tool_call_resp = serde_json::json!({
        "id": "harness-tool",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_echo",
                    "type": "function",
                    "function": {
                        "name": "bash",
                        "arguments": r#"{"argv":["echo","sovereign"]}"#
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("tool executed", 20, 6);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "run echo", "tool-use harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty());

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(
        v["content"], "tool executed",
        "final LLM text must be stored after tool loop"
    );

    let tool_calls = v["tool_calls"]
        .as_array()
        .expect("tool_calls must be array");
    assert!(
        !tool_calls.is_empty(),
        "at least one tool call must be logged in AgentResponse"
    );
    assert_eq!(
        tool_calls[0]["name"], "bash",
        "tool name must match what LLM requested"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_find_references_tool_reads_lsp_locations() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");
    if !python3_is_available_for_harness() {
        eprintln!("skipping references harness: python3 is not runnable");
        return;
    }

    clean_model_env();

    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("lib.rs");
    let fake_lsp = dir.path().join("fake_lsp.py");
    std::fs::write(&source, "let old = old;\n").unwrap();
    std::fs::write(&fake_lsp, FAKE_LSP_CODE_OPS_SERVER).unwrap();

    let arguments = serde_json::json!({
        "file": source.to_string_lossy(),
        "line": 1,
        "column": 5
    })
    .to_string();
    let tool_call_resp = serde_json::json!({
        "id": "harness-references",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_refs",
                    "type": "function",
                    "function": {
                        "name": "find_references",
                        "arguments": arguments
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("references found", 20, 6);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var(
        "REFACTOR_LSP_CMD",
        format!("python3 {}", fake_lsp.display()),
    );

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "find references for old",
        "find references harness",
    )
    .await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty());
    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["content"], "references found");
    let result = v["tool_calls"][0]["result"].as_str().unwrap_or("");
    assert!(
        result.contains("\"kind\": \"reference\""),
        "missing reference kind: {result}"
    );
    assert!(
        result.contains("\"line\": 1"),
        "missing 1-based line: {result}"
    );
    assert!(
        result.contains("\"column\": 5"),
        "missing 1-based column: {result}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_rename_symbol_tool_updates_workspace_file_via_lsp() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");
    if !python3_is_available_for_harness() {
        eprintln!("skipping rename harness: python3 is not runnable");
        return;
    }

    clean_model_env();

    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("lib.rs");
    let fake_lsp = dir.path().join("fake_lsp.py");
    std::fs::write(&source, "let old = old;\n").unwrap();
    std::fs::write(&fake_lsp, FAKE_LSP_CODE_OPS_SERVER).unwrap();

    let arguments = serde_json::json!({
        "file": source.to_string_lossy(),
        "line": 1,
        "column": 5,
        "new_name": "new_name"
    })
    .to_string();
    let tool_call_resp = serde_json::json!({
        "id": "harness-rename",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_rename",
                    "type": "function",
                    "function": {
                        "name": "rename_symbol",
                        "arguments": arguments
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("rename applied", 20, 6);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var(
        "REFACTOR_LSP_CMD",
        format!("python3 {}", fake_lsp.display()),
    );

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "rename old to new_name",
        "rename symbol harness",
    )
    .await;

    assert_eq!(
        std::fs::read_to_string(&source).unwrap(),
        "let new_name = new_name;\n"
    );
    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty());
    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(v["content"], "rename applied");
    let result = v["tool_calls"][0]["result"].as_str().unwrap_or("");
    assert!(
        result.contains("1 files changed, 2 edits applied"),
        "rename tool result must report applied edits: {result}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_fallback_serves_response_on_primary_failure() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    // Primary: anthropic with no API key — fails before any HTTP call.
    // Fallback: ollama pointing to working mock.
    let port = mock_llm_server(openai_response("fallback respondeu", 10, 4)).await;
    std::env::set_var("MODEL_PROVIDER", "anthropic");
    std::env::set_var("MODEL_FALLBACK_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "test fallback", "fallback harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty());

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(
        v["content"], "fallback respondeu",
        "fallback must serve valid response when primary fails: {:?}",
        v["content"]
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_multi_turn_history_included_in_request() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();
    std::env::set_var("MODEL_PROVIDER", "ollama");

    // One mock server handles all three on_event calls and captures every request body.
    let resp = openai_response("ok", 5, 3);
    let (port, mut captured) =
        mock_llm_server_capturing(vec![resp.clone(), resp.clone(), resp]).await;
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    // Turns 1 and 2: history disabled — build CRDT state only.
    call_on_event_with_timeout(&mut handle, "first question", "history harness turn 1").await;
    let _req1 = captured.recv().await.expect("mock must receive request 1");

    call_on_event_with_timeout(&mut handle, "second question", "history harness turn 2").await;
    let _req2 = captured.recv().await.expect("mock must receive request 2");

    // Turn 3: opt-in history — prior turns must appear in the outgoing request.
    // History is opted in per-call via the `history_turns` payload FIELD, exactly
    // as production delivers it (sidecar/dispatch.rs bakes history_turns into the
    // structured on_event payload; the guest EnvGuard-sets MODEL_HISTORY_TURNS for
    // that call in prompt_handler.rs). A host-side set_var AFTER load would not
    // reach the guest — the WASI env is frozen once at load time.
    let turn3 = serde_json::json!({ "prompt": "third question", "history_turns": 2 });
    call_on_event_with_timeout(&mut handle, &turn3.to_string(), "history harness turn 3").await;
    let req3 = captured.recv().await.expect("mock must receive request 3");

    let messages = req3["messages"]
        .as_array()
        .expect("request must have messages array");
    // With history: system + ≥1 prior turn + current = at least 3 messages.
    assert!(
        messages.len() >= 3,
        "MODEL_HISTORY_TURNS=2 must inject prior turns into request, got {} messages",
        messages.len()
    );

    // Prior content from the CRDT must appear somewhere in the request.
    let all_content: String = messages
        .iter()
        .filter_map(|m| m["content"].as_str())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        all_content.contains("second question") || all_content.contains("ok"),
        "prior turn content must appear in request body: {all_content}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_tool_output_truncated_when_max_lines_set() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    // Mock: LLM requests `seq 1 10` → produces 10 lines → truncated to 3.
    let tool_call_resp = serde_json::json!({
        "id": "harness-trunc",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_seq",
                    "type": "function",
                    "function": {
                        "name": "bash",
                        "arguments": r#"{"argv":["seq","1","10"]}"#
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("truncation applied", 20, 6);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_TOOL_OUTPUT_MAX_LINES", "3");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "count to ten", "tool truncation harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty(), "AgentResponse must be stored");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let tool_calls = v["tool_calls"]
        .as_array()
        .expect("tool_calls must be array");
    assert!(!tool_calls.is_empty(), "tool call must be logged");

    // The result stored in CRDT is what was fed back to the LLM — must be truncated.
    let result = tool_calls[0]["result"].as_str().unwrap_or("");
    assert!(
        result.contains("[truncated:"),
        "tool output must contain truncation header when MODEL_TOOL_OUTPUT_MAX_LINES=3, got: {result}"
    );
    // Verify only 3 lines of actual content remain after the header.
    let content_lines: Vec<&str> = result.lines().skip(1).collect();
    assert_eq!(
        content_lines.len(),
        3,
        "exactly 3 content lines must survive truncation, got: {content_lines:?}"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_refarm_config_json_injects_provider() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    // Write .refarm/config.json in a temp dir; CWD change makes tractor pick it up.
    let dir = tempfile::tempdir().unwrap();
    let refarm_dir = dir.path().join(".refarm");
    std::fs::create_dir_all(&refarm_dir).unwrap();
    std::fs::write(
        refarm_dir.join("config.json"),
        r#"{"provider":"ollama","model":"llama3.2"}"#,
    )
    .unwrap();

    // Set up mock before changing CWD (mock server uses process networking, not FS).
    let port = mock_llm_server(openai_response("config injetado", 8, 4)).await;
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    // Intentionally do NOT set MODEL_PROVIDER — it must come from config.json.

    let original_dir = std::env::current_dir().unwrap();
    std::env::set_current_dir(dir.path()).unwrap();

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "test config injection",
        "config injection harness",
    )
    .await;

    std::env::set_current_dir(original_dir).unwrap();

    // AgentResponse must exist — proves the plugin reached the mock LLM successfully,
    // which means config.json's provider="ollama" was injected into the WASM env.
    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(
        !nodes.is_empty(),
        "AgentResponse must be stored — config.json provider must have been injected"
    );

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    assert_eq!(
        v["content"], "config injetado",
        "response content must match mock — plugin must have used ollama from config.json"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_agent_id_namespaces_crdt_nodes() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    let port = mock_llm_server(openai_response("namespaced response", 5, 3)).await;
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_AGENT_ID", "test-agent-alpha");

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "hello from test-agent-alpha",
        "agent id harness",
    )
    .await;

    // All stored nodes whose @id is emitted by new_id() must carry the agent namespace.
    let session_nodes = sync.query_nodes("Session").expect("query Session");
    let entry_nodes = sync
        .query_nodes("SessionEntry")
        .expect("query SessionEntry");

    // At least one Session and SessionEntry must exist after the prompt.
    assert!(
        !session_nodes.is_empty(),
        "at least one Session must be stored"
    );
    assert!(
        !entry_nodes.is_empty(),
        "at least one SessionEntry must be stored"
    );

    for node in session_nodes.iter().chain(entry_nodes.iter()) {
        let v: serde_json::Value = serde_json::from_str(&node.payload).unwrap();
        let id = v["@id"].as_str().unwrap_or("");
        // The namespace must be CARRIED, not necessarily lead: Session/SessionEntry
        // ids now get a typed `urn:refarm:session:v1:` scheme prefix, so the agent
        // namespace is an embedded segment (e.g. urn:refarm:session:v1:urn:farmhand:
        // test-agent-alpha:…) rather than the leading one.
        assert!(
            id.contains("urn:farmhand:test-agent-alpha:"),
            "node @id must carry agent namespace: {id}"
        );
    }

    // AgentResponse itself is stored with a content hash as @id (not new_id), so we
    // only assert it exists to confirm the full pipeline ran.
    let responses = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!responses.is_empty(), "AgentResponse must be stored");

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_session_entries_stored_for_each_turn() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    let port = mock_llm_server(openai_response("turn response", 5, 3)).await;
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    // Send first prompt.
    call_on_event_with_timeout(&mut handle, "first message", "session harness turn 1").await;

    let entries_after_1 = sync
        .query_nodes("SessionEntry")
        .expect("query SessionEntry turn 1");
    let sessions_after_1 = sync.query_nodes("Session").expect("query Session turn 1");

    assert!(
        !sessions_after_1.is_empty(),
        "Session must exist after first prompt"
    );
    // Each prompt stores: user SessionEntry + agent SessionEntry (at minimum)
    assert!(
        entries_after_1.len() >= 2,
        "at least 2 SessionEntry after first turn: {}",
        entries_after_1.len()
    );

    let leaf_after_1 = {
        let v: serde_json::Value = serde_json::from_str(&sessions_after_1[0].payload).unwrap();
        v["leaf_entry_id"].as_str().unwrap_or("").to_string()
    };
    assert!(
        !leaf_after_1.is_empty(),
        "leaf_entry_id must be set after first turn"
    );

    // Send second prompt to same handle (same session).
    call_on_event_with_timeout(&mut handle, "second message", "session harness turn 2").await;

    let entries_after_2 = sync
        .query_nodes("SessionEntry")
        .expect("query SessionEntry turn 2");
    let sessions_after_2 = sync.query_nodes("Session").expect("query Session turn 2");

    assert!(
        entries_after_2.len() > entries_after_1.len(),
        "more SessionEntry nodes after second turn: {} > {}",
        entries_after_2.len(),
        entries_after_1.len()
    );

    // leaf_entry_id must have advanced.
    let leaf_after_2 = {
        let v: serde_json::Value = serde_json::from_str(&sessions_after_2[0].payload).unwrap();
        v["leaf_entry_id"].as_str().unwrap_or("").to_string()
    };
    assert_ne!(
        leaf_after_1, leaf_after_2,
        "leaf_entry_id must advance between turns"
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_write_structured_tool_creates_file() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    let dir = tempfile::tempdir().unwrap();
    let out_file = dir.path().join("output.json");
    let out_path = out_file.to_str().unwrap().to_string();
    let json_content = r#"{"result":"ok","value":42}"#;

    let tool_call_resp = serde_json::json!({
        "id": "harness-ws",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_ws",
                    "type": "function",
                    "function": {
                        "name": "write_structured",
                        "arguments": serde_json::json!({
                            "path": out_path,
                            "content": json_content,
                            "format": "json"
                        }).to_string()
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("file written", 15, 5);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    // Pin the provider to match the host's route (host defaults to ollama, the
    // guest to openai — without this pin the model-route guardrail blocks the
    // request before any tool dispatch). Every other tool-call harness test
    // sets this; the two _structured_ tests were the only ones missing it.
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_FS_ROOT", dir.path().to_str().unwrap());

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(
        &mut handle,
        "write structured json",
        "write structured harness",
    )
    .await;

    // File must exist and contain valid JSON.
    assert!(
        out_file.exists(),
        "write_structured must create the file at {out_path}"
    );
    let written = std::fs::read_to_string(&out_file).unwrap();
    let parsed: serde_json::Value =
        serde_json::from_str(&written).expect("written content must be valid JSON");
    assert_eq!(parsed["result"], "ok");
    assert_eq!(parsed["value"], 42);

    clean_model_env();
    std::env::remove_var("MODEL_FS_ROOT");
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_read_structured_tool_returns_paginated_header() {
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    clean_model_env();

    let dir = tempfile::tempdir().unwrap();
    let json_file = dir.path().join("data.json");
    // Write a JSON array with 10 items to the temp file.
    let data: Vec<serde_json::Value> = (0..10).map(|i| serde_json::json!({"n": i})).collect();
    std::fs::write(&json_file, serde_json::to_string(&data).unwrap()).unwrap();

    let file_path = json_file.to_str().unwrap().to_string();

    let tool_call_resp = serde_json::json!({
        "id": "harness-rs",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_rs",
                    "type": "function",
                    "function": {
                        "name": "read_structured",
                        "arguments": serde_json::json!({
                            "path": file_path,
                            "format": "json",
                            "page_size": 3,
                            "page_offset": 0
                        }).to_string()
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    });
    let final_resp = openai_response("read structured done", 15, 5);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    // Pin the provider to match the host's route (host defaults to ollama, the
    // guest to openai — without this pin the model-route guardrail blocks the
    // request before any tool dispatch). Every other tool-call harness test
    // sets this; the two _structured_ tests were the only ones missing it.
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));
    std::env::set_var("MODEL_FS_ROOT", dir.path().to_str().unwrap());

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "read the json file", "read structured harness").await;

    // The tool result (fed back to LLM) must contain the pagination header.
    // It is stored in AgentResponse.tool_calls[0].result.
    let responses = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!responses.is_empty(), "AgentResponse must exist");

    let v: serde_json::Value = serde_json::from_str(&responses[0].payload).unwrap();
    let tool_calls = v["tool_calls"]
        .as_array()
        .expect("tool_calls must be array");
    assert!(
        !tool_calls.is_empty(),
        "at least one tool call must be logged"
    );

    let result_str = tool_calls[0]["result"].as_str().unwrap_or("");
    assert!(
        result_str.contains("read_structured") || result_str.contains("total="),
        "tool result must contain structured-io header: {result_str}"
    );

    clean_model_env();
    std::env::remove_var("MODEL_FS_ROOT");
}

// ── Multi-agent swarm harness ─────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
async fn harness_swarm_agent_b_reads_agent_a_crdt_nodes() {
    // Verifies cross-agent CRDT coordination:
    //   Agent A (MODEL_AGENT_ID=alpha) stores an AgentResponse.
    //   Agent B (MODEL_AGENT_ID=beta)  is then loaded with the SAME NativeSync
    //   (same storage namespace). query_nodes("Response") must return A's node.
    //   This is the fundamental multi-agent coordination primitive.
    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");

    // ── Agent A fires ──────────────────────────────────────────────────────────
    clean_model_env();
    let port_a = mock_llm_server(openai_response("alpha response", 10, 5)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port_a}"));
    std::env::set_var("MODEL_AGENT_ID", "alpha");

    let shared_sync = make_sync();

    let host_a = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle_a = host_a.load(path, &shared_sync).await.expect("load agent A");
    call_on_event_with_timeout(&mut handle_a, "agent A prompt", "swarm harness agent A").await;

    // Confirm A's node is namespaced with alpha prefix.
    let nodes_after_a = shared_sync
        .query_nodes("Response")
        .expect("query after A");
    assert!(
        !nodes_after_a.is_empty(),
        "Agent A must store at least one AgentResponse"
    );
    let a_payload: serde_json::Value = serde_json::from_str(&nodes_after_a[0].payload).unwrap();
    let a_id = a_payload["@id"].as_str().unwrap_or("");
    assert!(
        a_id.contains("urn:farmhand:alpha:"),
        "Agent A node @id must carry agent namespace: {a_id}"
    );

    // ── Agent B fires ──────────────────────────────────────────────────────────
    clean_model_env();
    let port_b = mock_llm_server(openai_response("beta response", 8, 4)).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port_b}"));
    std::env::set_var("MODEL_AGENT_ID", "beta");

    // Agent B uses the SAME shared_sync — same storage namespace.
    let host_b = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle_b = host_b.load(path, &shared_sync).await.expect("load agent B");
    call_on_event_with_timeout(&mut handle_b, "agent B prompt", "swarm harness agent B").await;

    // ── Cross-agent read ──────────────────────────────────────────────────────
    let all_nodes = shared_sync
        .query_nodes("Response")
        .expect("query all AgentResponse");
    assert!(
        all_nodes.len() >= 2,
        "both agent responses must be in shared CRDT"
    );

    let namespaced_count = all_nodes
        .iter()
        .filter_map(|n| serde_json::from_str::<serde_json::Value>(&n.payload).ok())
        .filter_map(|v| v["@id"].as_str().map(|s| s.to_owned()))
        .filter(|id| id.contains("urn:farmhand:"))
        .count();
    // Both agents' nodes are in the shared store — cross-agent coordination works.
    assert!(
        namespaced_count >= 2,
        "both alpha and beta namespace nodes must be present: found {namespaced_count}"
    );

    clean_model_env();
}

// ── Pre-tool budget enforcement (ADR-058) ─────────────────────────────────────

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
/// Verifies that read_file gets limit=300 injected automatically and returns
/// a truncation header when the file has more lines than the default budget.
async fn harness_pre_tool_budget_read_file_gets_default_limit() {
    use std::io::Write as _;

    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");
    clean_model_env();

    // Create a temp file with 400 lines.
    let mut tmp = tempfile::NamedTempFile::new().expect("tempfile");
    for i in 1..=400u32 {
        writeln!(tmp, "line {i}").unwrap();
    }
    let tmp_path = tmp.path().to_str().unwrap().to_owned();

    // LLM asks to read the file with no limit specified.
    let tool_call_resp = serde_json::json!({
        "id": "harness-budget-read",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_read",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": serde_json::json!({"path": tmp_path}).to_string()
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 15, "completion_tokens": 8, "total_tokens": 23}
    });
    let final_resp = openai_response("read budget enforced", 30, 7);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "read the big file", "budget read harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty(), "AgentResponse must be stored");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let tool_calls = v["tool_calls"].as_array().expect("tool_calls array");
    assert!(!tool_calls.is_empty(), "tool call must be logged");

    let result = tool_calls[0]["result"].as_str().unwrap_or("");
    assert!(
        result.contains("[truncated:"),
        "read_file without explicit limit must be truncated at 300 lines by default, got: {result}",
    );
    assert!(
        result.contains("offset=300"),
        "truncation header must include the continuation offset, got: {result}",
    );

    clean_model_env();
}

#[tokio::test]
#[ignore = "requires: cargo component build --release in packages/agent"]
/// Verifies that the model can override the default limit by passing a smaller limit.
async fn harness_pre_tool_budget_model_can_override_limit() {
    use std::io::Write as _;

    let _env = env_lock();
    let path = wasm_path();
    assert!(path.exists(), "agent.wasm not found");
    clean_model_env();

    // Create a temp file with 50 lines (under the 300 default).
    let mut tmp = tempfile::NamedTempFile::new().expect("tempfile");
    for i in 1..=50u32 {
        writeln!(tmp, "line {i}").unwrap();
    }
    let tmp_path = tmp.path().to_str().unwrap().to_owned();

    // Model explicitly passes limit=10 — should override the default 300.
    let tool_call_resp = serde_json::json!({
        "id": "harness-budget-override",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_read_override",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": serde_json::json!({"path": tmp_path, "limit": 10}).to_string()
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 15, "completion_tokens": 8, "total_tokens": 23}
    });
    let final_resp = openai_response("read with explicit limit", 30, 7);

    let port = mock_llm_server_sequence(vec![tool_call_resp, final_resp]).await;
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let sync = make_sync();
    let host = PluginHost::new(TrustManager::new(), TelemetryBus::new(100), tractor::host::DEFAULT_ON_EVENT_BUDGET_MS).unwrap();
    let mut handle = host.load(path, &sync).await.expect("load agent");

    call_on_event_with_timeout(&mut handle, "read 10 lines only", "budget override harness").await;

    let nodes = sync
        .query_nodes("Response")
        .expect("query AgentResponse");
    assert!(!nodes.is_empty(), "AgentResponse must be stored");

    let v: serde_json::Value = serde_json::from_str(&nodes[0].payload).unwrap();
    let tool_calls = v["tool_calls"].as_array().expect("tool_calls array");
    assert!(!tool_calls.is_empty(), "tool call must be logged");

    let result = tool_calls[0]["result"].as_str().unwrap_or("");
    assert!(
        result.contains("[truncated:") || result.lines().count() <= 10,
        "model-specified limit=10 must cap the result at 10 lines, got: {result}",
    );

    clean_model_env();
}
