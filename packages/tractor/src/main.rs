//! tractor-native daemon + CLI helpers
//!
//! Default mode (no subcommand): starts the WebSocket daemon on port 42000.
//! Additional utility subcommands:
//!   - `prompt`: send `user:prompt` JSON over WS and optionally wait for AgentResponse
//!   - `watch`:  poll storage and print new AgentResponse records
//!   - `health`: probe runtime boot + daemon WS readiness

use std::{collections::HashSet, io::Write};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use tokio::time::{sleep, Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tractor::{
    NativeStorage, TractorNative, TractorNativeConfig,
    trust::SecurityMode,
};

const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT: &str = "final_text";
const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL: &str = "final_tool_call";
const STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY: &str = "final_empty";
const STREAM_SESSION_STATUS_COMPLETED: &str = "completed";
const AGENT_RESPONSE_STREAM_REF_PREFIX: &str = "urn:tractor:stream:agent-response:";
const STREAM_SESSION_STATUS_FAILED: &str = "failed";

#[derive(Parser, Debug)]
#[command(name = "tractor", about = "Refarm sovereign WASM plugin host")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    #[command(flatten)]
    daemon: DaemonArgs,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Send a prompt over the daemon WS text channel (`user:prompt`).
    Prompt(PromptArgs),
    /// Watch AgentResponse nodes from storage (polling fallback).
    Watch(WatchArgs),
    /// Validate runtime boot + daemon websocket readiness.
    Health(HealthArgs),
    /// Query CRDT nodes by type from local storage (no daemon required).
    Query(QueryArgs),
    /// Store a raw CRDT node payload into local storage (no daemon required).
    StoreNode(StoreNodeArgs),
}

#[derive(Args, Debug, Clone)]
struct DaemonArgs {
    /// Storage namespace (maps to ~/.local/share/refarm/{namespace}.db)
    #[arg(long, default_value = "default")]
    namespace: String,

    /// WebSocket daemon port
    #[arg(long, default_value_t = 42000)]
    port: u16,

    /// Security mode: strict | permissive | none
    #[arg(long, default_value = "strict")]
    security_mode: String,

    /// Log level: trace | debug | info | warn | error
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Load a WASM plugin at startup (may be repeated: --plugin a.wasm --plugin b.wasm)
    #[arg(long, value_name = "PATH")]
    plugin: Vec<std::path::PathBuf>,

    /// Fail startup when any --plugin path cannot be loaded.
    ///
    /// Default behavior is warn+continue (isolated plugin failure does not
    /// prevent daemon boot). Enabling this flag switches startup to fail-fast.
    #[arg(long, default_value_t = false)]
    require_plugin_load: bool,

    /// Trigger plugin ingest() immediately after successful startup load.
    ///
    /// This enables an operational/manual CLI path to run ingest without a
    /// separate scheduler. Ingest errors are warn+continue by default.
    #[arg(long, default_value_t = false)]
    ingest_on_load: bool,

    /// Fail startup when ingest-on-load is enabled and any plugin ingest fails.
    ///
    /// This implies ingest-on-load behavior even when `--ingest-on-load` is
    /// not explicitly provided.
    #[arg(long, default_value_t = false)]
    require_plugin_ingest: bool,

    /// Opt loaded LLM plugins into host-proxied provider streaming.
    ///
    /// This sets LLM_STREAM_RESPONSES=1 before startup plugins are loaded.
    /// Existing process environments can still opt in without this flag.
    #[arg(long, default_value_t = false)]
    llm_stream_responses: bool,

    /// HTTP sidecar port (ADR-060 effort protocol). Set to 0 to disable.
    #[arg(long, default_value_t = 42001)]
    http_port: u16,

    /// Base directory for streams and task-results (default: ~/.refarm)
    #[arg(long)]
    refarm_dir: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PluginLoadPolicy {
    WarnAndContinue,
    FailFast,
}

fn plugin_load_policy(args: &DaemonArgs) -> PluginLoadPolicy {
    if args.require_plugin_load {
        PluginLoadPolicy::FailFast
    } else {
        PluginLoadPolicy::WarnAndContinue
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PluginIngestPolicy {
    Skip,
    WarnAndContinue,
    FailFast,
}

fn plugin_ingest_policy(args: &DaemonArgs) -> PluginIngestPolicy {
    if args.require_plugin_ingest {
        PluginIngestPolicy::FailFast
    } else if args.ingest_on_load {
        PluginIngestPolicy::WarnAndContinue
    } else {
        PluginIngestPolicy::Skip
    }
}

async fn maybe_ingest_on_load(
    handle: &mut tractor::host::PluginInstanceHandle,
    path: &std::path::Path,
    policy: PluginIngestPolicy,
) -> Result<()> {
    match policy {
        PluginIngestPolicy::Skip => Ok(()),
        PluginIngestPolicy::WarnAndContinue | PluginIngestPolicy::FailFast => {
            match handle.call_ingest().await {
                Ok(count) => {
                    tracing::info!(
                        path = %path.display(),
                        plugin_id = %handle.id,
                        ingested = count,
                        "plugin ingest completed during startup"
                    );
                    Ok(())
                }
                Err(e) => {
                    if policy == PluginIngestPolicy::FailFast {
                        anyhow::bail!(
                            "required plugin ingest failed during startup (path={} plugin_id={}): {e}",
                            path.display(),
                            handle.id
                        );
                    }
                    tracing::warn!(
                        path = %path.display(),
                        plugin_id = %handle.id,
                        "plugin ingest failed during startup: {e}"
                    );
                    Ok(())
                }
            }
        }
    }
}

#[derive(Args, Debug)]
struct PromptArgs {
    /// Agent/plugin id registered in tractor daemon (e.g. pi-agent)
    #[arg(long, default_value = "pi-agent")]
    agent: String,

    /// Prompt payload sent to plugin `on_event("user:prompt", payload)`
    #[arg(long)]
    payload: String,

    /// WebSocket daemon port
    #[arg(long, default_value_t = 42000)]
    ws_port: u16,

    /// Namespace used by storage polling while waiting for AgentResponse
    #[arg(long, default_value = "default")]
    namespace: String,

    /// Wait for final response up to this timeout (0 = fire-and-forget)
    #[arg(long, default_value_t = 15_000)]
    wait_timeout_ms: u64,

    /// Poll interval for storage watcher while waiting
    #[arg(long, default_value_t = 250)]
    poll_interval_ms: u64,

    /// Output format: json (full record) or plain (content text + metadata comment)
    #[arg(long, default_value = "json")]
    format: String,
}

#[derive(Args, Debug)]
struct WatchArgs {
    /// Namespace to read (`~/.local/share/refarm/{namespace}.db`)
    #[arg(long, default_value = "default")]
    namespace: String,

    /// Node type to watch. AgentResponse keeps the compatibility plain renderer;
    /// StreamChunk/StreamSession use generic node rendering.
    #[arg(long, default_value = "AgentResponse")]
    r#type: String,

    /// Filter by source_plugin (e.g. pi-agent). Empty = all.
    #[arg(long, default_value = "pi-agent")]
    agent: String,

    /// Filter payloads by stream_ref (useful for StreamChunk/StreamSession).
    #[arg(long)]
    stream_ref: Option<String>,

    /// Derive stream_ref from an AgentResponse prompt_ref.
    #[arg(long)]
    prompt_ref: Option<String>,

    /// Poll interval (milliseconds)
    #[arg(long, default_value_t = 250)]
    poll_interval_ms: u64,

    /// Stop after first new response arrives
    #[arg(long, default_value_t = false)]
    once: bool,

    /// Max watch time (0 = run until Ctrl-C)
    #[arg(long, default_value_t = 60_000)]
    timeout_ms: u64,

    /// Exit when a final response (`is_final=true`) arrives
    #[arg(long, default_value_t = false)]
    until_final: bool,

    /// Output format: json (full record) or plain (content text + metadata comment)
    #[arg(long, default_value = "json")]
    format: String,
}

#[derive(Args, Debug)]
struct HealthArgs {
    /// WebSocket daemon port expected to be serving readiness checks.
    #[arg(long, default_value_t = 42000)]
    ws_port: u16,

    /// Timeout budget for WS readiness checks.
    #[arg(long, default_value_t = 1500)]
    ws_timeout_ms: u64,

    /// Namespace used for the minimal boot probe (`:memory:` recommended).
    #[arg(long, default_value = ":memory:")]
    boot_namespace: String,

    /// Skip minimal runtime boot/shutdown probe and only check daemon WS.
    #[arg(long, default_value_t = false)]
    skip_boot_probe: bool,
}

#[derive(Args, Debug)]
struct QueryArgs {
    /// Node type to query (e.g. Session, SessionEntry, AgentResponse).
    #[arg(long)]
    r#type: String,

    /// Filter by source_plugin (empty = all).
    #[arg(long, default_value = "")]
    agent: String,

    /// Filter payloads by stream_ref (useful for StreamChunk/StreamSession).
    #[arg(long)]
    stream_ref: Option<String>,

    /// Derive stream_ref from an AgentResponse prompt_ref.
    #[arg(long)]
    prompt_ref: Option<String>,

    /// Maximum number of nodes to return.
    #[arg(long, default_value_t = 100)]
    limit: usize,

    /// Storage namespace.
    #[arg(long, default_value = "default")]
    namespace: String,

    /// Output format: json (array of payloads) or plain (one payload per line).
    #[arg(long, default_value = "json")]
    format: String,
}

#[derive(Args, Debug)]
struct StoreNodeArgs {
    /// JSON payload of the node to store (must contain @type and @id).
    #[arg(long)]
    payload: String,

    /// Storage namespace.
    #[arg(long, default_value = "default")]
    namespace: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum OutputFormat {
    #[default]
    Json,
    Plain,
}

impl OutputFormat {
    fn from_str(s: &str) -> Self {
        if s.eq_ignore_ascii_case("plain") { Self::Plain } else { Self::Json }
    }
}

#[derive(Debug)]
struct AgentResponseEvent {
    id: String,
    source_plugin: Option<String>,
    updated_at: String,
    sequence: u64,
    is_final: bool,
    prompt_ref: Option<String>,
    content: String,
    timestamp_ns: u64,
    llm_tokens_in: u64,
    llm_tokens_out: u64,
    llm_estimated_usd: f64,
    llm_duration_ms: u64,
}

#[derive(Debug, Default)]
struct PlainResponseOutputState {
    partial_prompt_refs: HashSet<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct PlainResponseOutput {
    stdout: String,
    stderr: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Command::Prompt(args))    => run_prompt(args).await,
        Some(Command::Watch(args))     => run_watch(args).await,
        Some(Command::Health(args))    => run_health(args).await,
        Some(Command::Query(args))     => run_query(args),
        Some(Command::StoreNode(args)) => run_store_node(args),
        None                           => run_daemon(cli.daemon).await,
    }
}

async fn run_daemon(args: DaemonArgs) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| args.log_level.parse().unwrap_or_default()),
        )
        .init();

    let security_mode = match args.security_mode.as_str() {
        "permissive" => SecurityMode::Permissive,
        "none" => SecurityMode::None,
        _ => SecurityMode::Strict,
    };

    let config = TractorNativeConfig {
        namespace: args.namespace.clone(),
        port: args.port,
        security_mode,
        ..Default::default()
    };

    tracing::info!(namespace = %args.namespace, port = args.port, "Starting tractor daemon");

    if args.llm_stream_responses {
        std::env::set_var("LLM_STREAM_RESPONSES", "1");
        tracing::info!("LLM_STREAM_RESPONSES=1 enabled for startup plugins");
    }

    let tractor = TractorNative::boot(config.clone()).await?;

    let load_policy = plugin_load_policy(&args);
    let ingest_policy = plugin_ingest_policy(&args);
    for path in &args.plugin {
        match tractor.load_plugin(path).await {
            Ok(mut handle) => {
                tracing::info!(path = %path.display(), plugin_id = %handle.id, "plugin loaded");
                maybe_ingest_on_load(&mut handle, path, ingest_policy).await?;
                tractor.register_for_events(handle);
            }
            Err(e) => {
                if load_policy == PluginLoadPolicy::FailFast {
                    anyhow::bail!(
                        "required plugin failed to load during startup (path={}): {e}",
                        path.display()
                    );
                }
                tracing::warn!(path = %path.display(), "plugin load failed: {e}");
            }
        }
    }

    // ── HTTP sidecar (ADR-060) ────────────────────────────────────────────────
    if args.http_port > 0 {
        let base_dir = args
            .refarm_dir
            .clone()
            .unwrap_or_else(|| dirs_refarm_base());
        match tractor::sidecar::SidecarState::new(tractor.agent_channels.clone(), &base_dir, args.namespace.clone()) {
            Ok(state) => {
                let http_port = args.http_port;
                tokio::spawn(async move {
                    if let Err(e) = tractor::sidecar::start(state, http_port).await {
                        tracing::error!("HTTP sidecar error: {e}");
                    }
                });
                tracing::info!(port = args.http_port, "HTTP sidecar started (ADR-060)");
            }
            Err(e) => {
                tracing::warn!("HTTP sidecar disabled (failed to init dirs): {e}");
            }
        }
    }

    daemon::WsServer::new(
        std::sync::Arc::new(tractor.sync.clone()),
        config.port,
        tractor.telemetry.clone(),
        tractor.agent_channels.clone(),
    )
    .start()
    .await?;

    tractor.shutdown().await?;
    Ok(())
}

fn dirs_refarm_base() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".refarm")
}

async fn run_prompt(args: PromptArgs) -> Result<()> {
    let format = OutputFormat::from_str(&args.format);
    let mut seen = snapshot_seen_response_ids(&args.namespace, &args.agent)?;
    send_user_prompt(args.ws_port, &args.agent, &args.payload).await?;

    // In plain mode status goes to stderr so stdout stays clean for piping.
    if format == OutputFormat::Json {
        println!(
            "prompt sent: agent={} ws_port={} namespace={}",
            args.agent, args.ws_port, args.namespace
        );
    } else {
        eprintln!("sending to {}…", args.agent);
    }

    if args.wait_timeout_ms == 0 {
        return Ok(());
    }

    let got_final = poll_agent_responses(
        &args.namespace,
        &args.agent,
        &mut seen,
        PollAgentResponsesOptions {
            poll_interval: Duration::from_millis(args.poll_interval_ms.max(50)),
            timeout: Some(Duration::from_millis(args.wait_timeout_ms)),
            stop_after_first: false,
            stop_on_final: true,
            format,
        },
    )
    .await?;

    if !got_final {
        eprintln!(
            "no final AgentResponse within {}ms (prompt preserved; use `tractor watch` to continue)",
            args.wait_timeout_ms
        );
    }

    Ok(())
}

async fn run_watch(args: WatchArgs) -> Result<()> {
    let format = OutputFormat::from_str(&args.format);
    let timeout = if args.timeout_ms == 0 {
        None
    } else {
        Some(Duration::from_millis(args.timeout_ms))
    };
    let stream_ref_filter =
        resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())?;

    if args.r#type != "AgentResponse" || stream_ref_filter.is_some() {
        let mut seen = snapshot_seen_node_fingerprints(
            &args.namespace,
            &args.r#type,
            &args.agent,
            stream_ref_filter.as_deref(),
        )?;

        let _ = poll_node_rows(
            &args.namespace,
            &args.r#type,
            &args.agent,
            stream_ref_filter.as_deref(),
            &mut seen,
            PollNodeRowsOptions {
                poll_interval: Duration::from_millis(args.poll_interval_ms.max(50)),
                timeout,
                stop_after_first: args.once,
                stop_on_terminal: args.until_final,
                format,
            },
        )
        .await?;

        return Ok(());
    }

    let mut seen = snapshot_seen_response_ids(&args.namespace, &args.agent)?;

    let _ = poll_agent_responses(
        &args.namespace,
        &args.agent,
        &mut seen,
        PollAgentResponsesOptions {
            poll_interval: Duration::from_millis(args.poll_interval_ms.max(50)),
            timeout,
            stop_after_first: args.once,
            stop_on_final: args.until_final,
            format,
        },
    )
    .await?;

    Ok(())
}

async fn run_health(args: HealthArgs) -> Result<()> {
    if !args.skip_boot_probe {
        probe_runtime_boot(&args.boot_namespace).await?;
    }

    let ws_timeout = Duration::from_millis(args.ws_timeout_ms.max(100));
    probe_ws_daemon(args.ws_port, ws_timeout).await?;

    let report = serde_json::json!({
        "ok": true,
        "ws_port": args.ws_port,
        "ws_timeout_ms": ws_timeout.as_millis(),
        "boot_probe": !args.skip_boot_probe,
        "boot_namespace": args.boot_namespace,
    });
    println!("{}", report);
    Ok(())
}

async fn probe_runtime_boot(namespace: &str) -> Result<()> {
    let config = TractorNativeConfig {
        namespace: namespace.to_string(),
        port: 0,
        security_mode: SecurityMode::Strict,
        ..Default::default()
    };

    let tractor = TractorNative::boot(config)
        .await
        .with_context(|| format!("runtime boot probe failed for namespace '{namespace}'"))?;

    tractor
        .shutdown()
        .await
        .context("runtime shutdown probe failed")?;

    Ok(())
}

async fn probe_ws_daemon(port: u16, timeout_budget: Duration) -> Result<()> {
    let url = format!("ws://127.0.0.1:{port}");
    let (ws, _resp) = tokio::time::timeout(timeout_budget, connect_async(&url))
        .await
        .with_context(|| format!("health probe timeout while connecting to {url}"))?
        .with_context(|| format!("health probe failed to connect to {url}"))?;

    let (_sink, mut stream) = ws.split();

    let first = tokio::time::timeout(timeout_budget, stream.next())
        .await
        .with_context(|| format!("health probe timeout waiting initial frame from {url}"))?
        .ok_or_else(|| anyhow::anyhow!("health probe connection closed before initial frame"))?
        .with_context(|| format!("health probe websocket stream error from {url}"))?;

    match first {
        Message::Binary(_) => Ok(()),
        other => anyhow::bail!("health probe expected binary initial frame, got {other:?}"),
    }
}

async fn send_user_prompt(port: u16, agent: &str, payload: &str) -> Result<()> {
    let url = format!("ws://127.0.0.1:{port}");
    let (ws, _resp) = connect_async(&url)
        .await
        .with_context(|| format!("connect websocket {url}"))?;

    let (mut sink, mut stream) = ws.split();

    // Drain initial frame (server sends initial binary state on connect).
    let _ = stream.next().await;

    let msg = serde_json::json!({
        "type": "user:prompt",
        "agent": agent,
        "payload": payload,
    });

    sink.send(Message::Text(msg.to_string()))
        .await
        .context("send user:prompt")?;

    let _ = sink.close().await;
    Ok(())
}

fn run_query(args: QueryArgs) -> Result<()> {
    let storage = NativeStorage::open(&args.namespace)
        .with_context(|| format!("open storage namespace '{}'", args.namespace))?;

    let stream_ref_filter =
        resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())?;
    let mut rows = storage.query_nodes(&args.r#type)?;
    rows.retain(|row| row_matches_cli_filters(row, &args.agent, stream_ref_filter.as_deref()));
    rows.sort_by(cli_node_order);
    let rows: Vec<_> = rows.into_iter().take(args.limit).collect();

    if args.format.eq_ignore_ascii_case("json") {
        let payloads: Vec<serde_json::Value> = rows.iter()
            .filter_map(|r| serde_json::from_str(&r.payload).ok())
            .collect();
        println!("{}", serde_json::to_string(&payloads).unwrap_or_else(|_| "[]".into()));
    } else {
        for row in &rows {
            println!("{}", row.payload);
        }
    }
    Ok(())
}

fn run_store_node(args: StoreNodeArgs) -> Result<()> {
    // Validate: payload must be valid JSON with @type and @id.
    let v: serde_json::Value = serde_json::from_str(&args.payload)
        .context("--payload must be valid JSON")?;
    let node_type = v["@type"].as_str()
        .ok_or_else(|| anyhow::anyhow!("payload must contain @type field"))?;
    let node_id = v["@id"].as_str()
        .ok_or_else(|| anyhow::anyhow!("payload must contain @id field"))?;

    let storage = NativeStorage::open(&args.namespace)
        .with_context(|| format!("open storage namespace '{}'", args.namespace))?;

    let sync = tractor::NativeSync::new(storage, &args.namespace)
        .context("create NativeSync for store-node")?;

    sync.store_node(node_id, node_type, None, &args.payload, Some("tractor-cli"))
        .context("store_node failed")?;

    println!("stored {node_type} {node_id}");
    Ok(())
}

fn resolve_stream_ref_filter(
    stream_ref: Option<&str>,
    prompt_ref: Option<&str>,
) -> Result<Option<String>> {
    match (stream_ref, prompt_ref) {
        (Some(_), Some(_)) => {
            anyhow::bail!("use either --stream-ref or --prompt-ref, not both")
        }
        (Some(stream_ref), None) => Ok(Some(stream_ref.to_string())),
        (None, Some("")) => anyhow::bail!("--prompt-ref must not be empty"),
        (None, Some(prompt_ref)) => Ok(Some(agent_response_stream_ref(prompt_ref))),
        (None, None) => Ok(None),
    }
}

fn agent_response_stream_ref(prompt_ref: &str) -> String {
    format!("{AGENT_RESPONSE_STREAM_REF_PREFIX}{prompt_ref}")
}

fn row_matches_cli_filters(
    row: &tractor::storage::NodeRow,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
) -> bool {
    if !agent_filter.is_empty() && row.source_plugin.as_deref() != Some(agent_filter) {
        return false;
    }

    let Some(stream_ref_filter) = stream_ref_filter else {
        return true;
    };

    serde_json::from_str::<serde_json::Value>(&row.payload)
        .ok()
        .and_then(|value| {
            value
                .get("stream_ref")
                .and_then(|stream_ref| stream_ref.as_str())
                .map(|stream_ref| stream_ref == stream_ref_filter)
        })
        .unwrap_or(false)
}

fn cli_node_order(
    left: &tractor::storage::NodeRow,
    right: &tractor::storage::NodeRow,
) -> std::cmp::Ordering {
    cli_node_time_key(left)
        .cmp(&cli_node_time_key(right))
        .then(left.id.cmp(&right.id))
}

fn cli_node_time_key(row: &tractor::storage::NodeRow) -> (u64, u64) {
    let value = serde_json::from_str::<serde_json::Value>(&row.payload).ok();
    let timestamp = value
        .as_ref()
        .and_then(|v| {
            v.get("timestamp_ns")
                .or_else(|| v.get("updated_at_ns"))
                .or_else(|| v.get("started_at_ns"))
                .and_then(|field| field.as_u64())
        })
        .unwrap_or(0);
    let sequence = value
        .as_ref()
        .and_then(|v| v.get("sequence").and_then(|field| field.as_u64()))
        .unwrap_or(0);
    (timestamp, sequence)
}

fn node_row_fingerprint(row: &tractor::storage::NodeRow) -> String {
    format!("{}\u{0}{}", row.id, row.payload)
}

fn snapshot_seen_node_fingerprints(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
) -> Result<HashSet<String>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let seen = storage
        .query_nodes(node_type)?
        .into_iter()
        .filter(|row| row_matches_cli_filters(row, agent_filter, stream_ref_filter))
        .map(|row| node_row_fingerprint(&row))
        .collect::<HashSet<_>>();

    Ok(seen)
}

fn collect_new_node_rows(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
    seen: &HashSet<String>,
) -> Result<Vec<tractor::storage::NodeRow>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let mut rows = storage
        .query_nodes(node_type)?
        .into_iter()
        .filter(|row| row_matches_cli_filters(row, agent_filter, stream_ref_filter))
        .filter(|row| !seen.contains(&node_row_fingerprint(row)))
        .collect::<Vec<_>>();
    rows.sort_by(cli_node_order);
    Ok(rows)
}

fn print_node_row(row: &tractor::storage::NodeRow, format: OutputFormat) {
    match format {
        OutputFormat::Json => {
            let payload = serde_json::from_str::<serde_json::Value>(&row.payload)
                .unwrap_or_else(|_| serde_json::Value::String(row.payload.clone()));
            let line = serde_json::json!({
                "id": row.id,
                "type": row.type_,
                "source_plugin": row.source_plugin,
                "updated_at": row.updated_at,
                "payload": payload,
            });
            println!("{}", line);
        }
        OutputFormat::Plain => {
            println!("{}", row.payload);
        }
    }
}

fn node_row_is_terminal(row: &tractor::storage::NodeRow) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
        return false;
    };

    if value.get("is_final").and_then(|field| field.as_bool()) == Some(true) {
        return true;
    }

    if matches!(
        value.get("payload_kind").and_then(|field| field.as_str()),
        Some(
            STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT
                | STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL
                | STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY,
        )
    ) {
        return true;
    }

    matches!(
        value.get("status").and_then(|field| field.as_str()),
        Some(STREAM_SESSION_STATUS_COMPLETED | STREAM_SESSION_STATUS_FAILED)
    )
}

fn snapshot_seen_response_ids(namespace: &str, agent_filter: &str) -> Result<HashSet<String>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let rows = storage.query_nodes("AgentResponse")?;
    let seen = rows
        .into_iter()
        .filter(|row| agent_filter.is_empty() || row.source_plugin.as_deref() == Some(agent_filter))
        .map(|row| row.id)
        .collect::<HashSet<_>>();

    Ok(seen)
}

fn collect_new_response_events(
    namespace: &str,
    agent_filter: &str,
    seen: &HashSet<String>,
) -> Result<Vec<AgentResponseEvent>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let mut out = Vec::new();
    for row in storage.query_nodes("AgentResponse")? {
        if seen.contains(&row.id) {
            continue;
        }
        if !agent_filter.is_empty() && row.source_plugin.as_deref() != Some(agent_filter) {
            continue;
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
            continue;
        };

        let sequence = v.get("sequence").and_then(|x| x.as_u64()).unwrap_or(0);
        let is_final = v.get("is_final").and_then(|x| x.as_bool()).unwrap_or(false);
        let content = v
            .get("content")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let prompt_ref = v
            .get("prompt_ref")
            .and_then(|x| x.as_str())
            .map(ToOwned::to_owned);
        let timestamp_ns = v.get("timestamp_ns").and_then(|x| x.as_u64()).unwrap_or(0);

        let llm = v.get("llm").and_then(|x| x.as_object());
        let llm_tokens_in  = llm.and_then(|m| m.get("tokens_in")).and_then(|x| x.as_u64()).unwrap_or(0);
        let llm_tokens_out = llm.and_then(|m| m.get("tokens_out")).and_then(|x| x.as_u64()).unwrap_or(0);
        let llm_estimated_usd = llm.and_then(|m| m.get("estimated_usd")).and_then(|x| x.as_f64()).unwrap_or(0.0);
        let llm_duration_ms   = llm.and_then(|m| m.get("duration_ms")).and_then(|x| x.as_u64()).unwrap_or(0);

        out.push(AgentResponseEvent {
            id: row.id,
            source_plugin: row.source_plugin,
            updated_at: row.updated_at,
            sequence,
            is_final,
            prompt_ref,
            content,
            timestamp_ns,
            llm_tokens_in,
            llm_tokens_out,
            llm_estimated_usd,
            llm_duration_ms,
        });
    }

    out.sort_by(|a, b| {
        a.timestamp_ns
            .cmp(&b.timestamp_ns)
            .then(a.sequence.cmp(&b.sequence))
            .then(a.id.cmp(&b.id))
    });

    Ok(out)
}

fn render_plain_response_event(
    event: &AgentResponseEvent,
    state: &mut PlainResponseOutputState,
) -> PlainResponseOutput {
    let prompt_key = event
        .prompt_ref
        .clone()
        .unwrap_or_else(|| "__tractor:no-prompt-ref__".to_string());
    let mut output = PlainResponseOutput::default();

    if event.is_final {
        if state.partial_prompt_refs.remove(&prompt_key) {
            output.stdout.push('\n');
        } else {
            output.stdout.push_str(&event.content);
            output.stdout.push('\n');
        }
        output.stderr = plain_response_metadata(event);
    } else {
        state.partial_prompt_refs.insert(prompt_key);
        output.stdout.push_str(&event.content);
    }

    output
}

fn plain_response_metadata(event: &AgentResponseEvent) -> String {
    if event.llm_tokens_in == 0 && event.llm_tokens_out == 0 {
        return String::new();
    }

    format!(
        "# {}→{} tokens  ${:.4}  {}ms\n",
        event.llm_tokens_in,
        event.llm_tokens_out,
        event.llm_estimated_usd,
        event.llm_duration_ms,
    )
}

struct PollAgentResponsesOptions {
    poll_interval: Duration,
    timeout: Option<Duration>,
    stop_after_first: bool,
    stop_on_final: bool,
    format: OutputFormat,
}

async fn poll_agent_responses(
    namespace: &str,
    agent_filter: &str,
    seen: &mut HashSet<String>,
    options: PollAgentResponsesOptions,
) -> Result<bool> {
    let deadline = options.timeout.map(|d| Instant::now() + d);
    let mut plain_output_state = PlainResponseOutputState::default();

    loop {
        if let Some(deadline) = deadline {
            if Instant::now() >= deadline {
                return Ok(false);
            }
        }

        let events = collect_new_response_events(namespace, agent_filter, seen)?;
        let mut got_final = false;

        for event in events {
            seen.insert(event.id.clone());

            match options.format {
                OutputFormat::Json => {
                    let line = serde_json::json!({
                        "id": event.id,
                        "source_plugin": event.source_plugin,
                        "updated_at": event.updated_at,
                        "sequence": event.sequence,
                        "is_final": event.is_final,
                        "prompt_ref": event.prompt_ref,
                        "timestamp_ns": event.timestamp_ns,
                        "content": event.content,
                    });
                    println!("{}", line);
                }
                OutputFormat::Plain => {
                    let output = render_plain_response_event(&event, &mut plain_output_state);
                    print!("{}", output.stdout);
                    std::io::stdout().flush().context("flush plain AgentResponse output")?;
                    if !output.stderr.is_empty() {
                        eprint!("{}", output.stderr);
                    }
                }
            }

            if event.is_final {
                got_final = true;
            }

            if options.stop_after_first {
                return Ok(got_final);
            }
        }

        if options.stop_on_final && got_final {
            return Ok(true);
        }

        sleep(options.poll_interval).await;
    }
}

struct PollNodeRowsOptions {
    poll_interval: Duration,
    timeout: Option<Duration>,
    stop_after_first: bool,
    stop_on_terminal: bool,
    format: OutputFormat,
}

async fn poll_node_rows(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
    seen: &mut HashSet<String>,
    options: PollNodeRowsOptions,
) -> Result<bool> {
    let deadline = options.timeout.map(|d| Instant::now() + d);

    loop {
        if let Some(deadline) = deadline {
            if Instant::now() >= deadline {
                return Ok(false);
            }
        }

        let rows = collect_new_node_rows(namespace, node_type, agent_filter, stream_ref_filter, seen)?;
        let mut got_terminal = false;

        for row in rows {
            seen.insert(node_row_fingerprint(&row));
            got_terminal |= node_row_is_terminal(&row);
            print_node_row(&row, options.format);

            if options.stop_after_first {
                return Ok(got_terminal);
            }
        }

        if options.stop_on_terminal && got_terminal {
            return Ok(true);
        }

        sleep(options.poll_interval).await;
    }
}

// Bring daemon module into scope for main.rs
use tractor::daemon;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use tokio::net::TcpListener;
    use tractor::{AgentChannels, NativeStorage, NativeSync, TelemetryBus};

    fn test_response_event(content: &str, is_final: bool, prompt_ref: Option<&str>) -> AgentResponseEvent {
        AgentResponseEvent {
            id: format!("event-{content}-{is_final}"),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-29T00:00:00Z".to_string(),
            sequence: 0,
            is_final,
            prompt_ref: prompt_ref.map(ToOwned::to_owned),
            content: content.to_string(),
            timestamp_ns: 0,
            llm_tokens_in: 0,
            llm_tokens_out: 0,
            llm_estimated_usd: 0.0,
            llm_duration_ms: 0,
        }
    }

    #[test]
    fn plain_output_streams_partials_without_reprinting_final_content() {
        let mut state = PlainResponseOutputState::default();

        let first = render_plain_response_event(
            &test_response_event("Olá ", false, Some("prompt-1")),
            &mut state,
        );
        let second = render_plain_response_event(
            &test_response_event("stream", false, Some("prompt-1")),
            &mut state,
        );
        let final_output = render_plain_response_event(
            &test_response_event("Olá stream", true, Some("prompt-1")),
            &mut state,
        );

        assert_eq!(first.stdout, "Olá ");
        assert_eq!(second.stdout, "stream");
        assert_eq!(final_output.stdout, "\n");
        assert!(final_output.stderr.is_empty());
    }

    #[test]
    fn plain_output_tracks_partial_state_per_prompt_ref() {
        let mut state = PlainResponseOutputState::default();

        let _ = render_plain_response_event(
            &test_response_event("first ", false, Some("prompt-a")),
            &mut state,
        );
        let final_b = render_plain_response_event(
            &test_response_event("other", true, Some("prompt-b")),
            &mut state,
        );
        let final_a = render_plain_response_event(
            &test_response_event("first done", true, Some("prompt-a")),
            &mut state,
        );

        assert_eq!(final_b.stdout, "other\n");
        assert_eq!(final_a.stdout, "\n");
    }

    #[test]
    fn plain_output_prints_non_streamed_final_content_and_metadata() {
        let mut state = PlainResponseOutputState::default();
        let mut event = test_response_event("done", true, Some("prompt-2"));
        event.llm_tokens_in = 3;
        event.llm_tokens_out = 4;
        event.llm_duration_ms = 25;

        let output = render_plain_response_event(&event, &mut state);

        assert_eq!(output.stdout, "done\n");
        assert_eq!(output.stderr, "# 3→4 tokens  $0.0000  25ms\n");
    }

    #[test]
    fn query_cli_filters_stream_rows_by_agent_and_stream_ref() {
        let row = tractor::storage::NodeRow {
            id: "chunk-1".to_string(),
            type_: "StreamChunk".to_string(),
            context: None,
            payload: serde_json::json!({
                "@type": "StreamChunk",
                "stream_ref": "stream-a",
                "sequence": 1,
                "timestamp_ns": 10,
            })
            .to_string(),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        };

        assert!(row_matches_cli_filters(&row, "pi-agent", Some("stream-a")));
        assert!(!row_matches_cli_filters(&row, "other-agent", Some("stream-a")));
        assert!(!row_matches_cli_filters(&row, "pi-agent", Some("stream-b")));
    }

    #[test]
    fn query_cli_orders_stream_rows_by_timestamp_and_sequence() {
        let mut rows = vec![
            tractor::storage::NodeRow {
                id: "chunk-b".to_string(),
                type_: "StreamChunk".to_string(),
                context: None,
                payload: serde_json::json!({ "timestamp_ns": 10, "sequence": 2 }).to_string(),
                source_plugin: Some("pi-agent".to_string()),
                updated_at: "2026-04-30T00:00:00Z".to_string(),
            },
            tractor::storage::NodeRow {
                id: "chunk-a".to_string(),
                type_: "StreamChunk".to_string(),
                context: None,
                payload: serde_json::json!({ "timestamp_ns": 10, "sequence": 1 }).to_string(),
                source_plugin: Some("pi-agent".to_string()),
                updated_at: "2026-04-30T00:00:00Z".to_string(),
            },
        ];

        rows.sort_by(cli_node_order);

        assert_eq!(rows[0].id, "chunk-a");
        assert_eq!(rows[1].id, "chunk-b");
    }

    #[test]
    fn daemon_cli_accepts_llm_stream_responses_flag() {
        let cli = Cli::try_parse_from(["tractor", "--llm-stream-responses"])
            .expect("cli parse");

        assert!(cli.daemon.llm_stream_responses);
    }

    #[test]
    fn watch_cli_accepts_generic_stream_filters() {
        let cli = Cli::try_parse_from([
            "tractor",
            "watch",
            "--type",
            "StreamChunk",
            "--stream-ref",
            "urn:tractor:stream:agent-response:prompt-1",
            "--until-final",
        ])
        .expect("cli parse");

        let Some(Command::Watch(args)) = cli.command else {
            panic!("expected watch command");
        };
        assert_eq!(args.r#type, "StreamChunk");
        assert_eq!(
            args.stream_ref.as_deref(),
            Some("urn:tractor:stream:agent-response:prompt-1")
        );
        assert!(args.until_final);
    }

    #[test]
    fn watch_cli_accepts_prompt_ref_stream_filter() {
        let cli = Cli::try_parse_from([
            "tractor",
            "watch",
            "--type",
            "StreamChunk",
            "--prompt-ref",
            "prompt-1",
            "--until-final",
        ])
        .expect("cli parse");

        let Some(Command::Watch(args)) = cli.command else {
            panic!("expected watch command");
        };
        assert_eq!(args.r#type, "StreamChunk");
        assert_eq!(args.prompt_ref.as_deref(), Some("prompt-1"));
        assert!(args.until_final);
        assert_eq!(
            resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())
                .expect("stream ref filter"),
            Some("urn:tractor:stream:agent-response:prompt-1".to_string())
        );
    }

    #[test]
    fn query_cli_accepts_prompt_ref_stream_filter() {
        let cli = Cli::try_parse_from([
            "tractor",
            "query",
            "--type",
            "StreamSession",
            "--prompt-ref",
            "prompt-1",
        ])
        .expect("cli parse");

        let Some(Command::Query(args)) = cli.command else {
            panic!("expected query command");
        };
        assert_eq!(args.r#type, "StreamSession");
        assert_eq!(args.prompt_ref.as_deref(), Some("prompt-1"));
        assert_eq!(
            resolve_stream_ref_filter(args.stream_ref.as_deref(), args.prompt_ref.as_deref())
                .expect("stream ref filter"),
            Some("urn:tractor:stream:agent-response:prompt-1".to_string())
        );
    }

    #[test]
    fn stream_ref_filter_rejects_ambiguous_inputs() {
        let err = resolve_stream_ref_filter(Some("stream-a"), Some("prompt-a"))
            .expect_err("ambiguous stream filters should fail");
        assert!(err.to_string().contains("either --stream-ref or --prompt-ref"));
    }

    #[test]
    fn stream_ref_filter_rejects_empty_prompt_refs() {
        let err = resolve_stream_ref_filter(None, Some(""))
            .expect_err("empty prompt refs should fail");
        assert!(err.to_string().contains("--prompt-ref must not be empty"));
    }

    #[test]
    fn generic_watch_detects_terminal_stream_rows() {
        let final_chunk = tractor::storage::NodeRow {
            id: "chunk-final".to_string(),
            type_: "StreamChunk".to_string(),
            context: None,
            payload: serde_json::json!({ "is_final": true }).to_string(),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        };
        let final_marker = tractor::storage::NodeRow {
            id: "chunk-marker".to_string(),
            type_: "StreamChunk".to_string(),
            context: None,
            payload: serde_json::json!({ "payload_kind": STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL }).to_string(),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        };
        let failed_session = tractor::storage::NodeRow {
            id: "session-failed".to_string(),
            type_: "StreamSession".to_string(),
            context: None,
            payload: serde_json::json!({ "status": STREAM_SESSION_STATUS_FAILED }).to_string(),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        };
        let active_session = tractor::storage::NodeRow {
            id: "session-active".to_string(),
            type_: "StreamSession".to_string(),
            context: None,
            payload: serde_json::json!({ "status": "active" }).to_string(),
            source_plugin: Some("pi-agent".to_string()),
            updated_at: "2026-04-30T00:00:00Z".to_string(),
        };

        assert!(node_row_is_terminal(&final_chunk));
        assert!(node_row_is_terminal(&final_marker));
        assert!(node_row_is_terminal(&failed_session));
        assert!(!node_row_is_terminal(&active_session));
    }

    #[test]
    fn plugin_load_policy_defaults_to_warn_and_continue() {
        let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
        assert_eq!(plugin_load_policy(&cli.daemon), PluginLoadPolicy::WarnAndContinue);
    }

    #[test]
    fn plugin_load_policy_switches_to_fail_fast_when_flag_is_set() {
        let cli = Cli::try_parse_from(["tractor", "--require-plugin-load"]).expect("cli parse");
        assert_eq!(plugin_load_policy(&cli.daemon), PluginLoadPolicy::FailFast);
    }

    #[test]
    fn require_plugin_load_flag_allows_plugin_arguments() {
        let cli = Cli::try_parse_from([
            "tractor",
            "--require-plugin-load",
            "--plugin",
            "./plugins/pi-agent.wasm",
        ])
        .expect("cli parse");

        assert_eq!(plugin_load_policy(&cli.daemon), PluginLoadPolicy::FailFast);
        assert_eq!(cli.daemon.plugin.len(), 1);
    }

    #[test]
    fn plugin_ingest_policy_defaults_to_skip() {
        let cli = Cli::try_parse_from(["tractor"]).expect("cli parse");
        assert_eq!(plugin_ingest_policy(&cli.daemon), PluginIngestPolicy::Skip);
    }

    #[test]
    fn plugin_ingest_policy_switches_to_warn_and_continue_when_enabled() {
        let cli = Cli::try_parse_from(["tractor", "--ingest-on-load"]).expect("cli parse");
        assert_eq!(
            plugin_ingest_policy(&cli.daemon),
            PluginIngestPolicy::WarnAndContinue
        );
    }

    #[test]
    fn plugin_ingest_policy_switches_to_fail_fast_when_flag_is_set() {
        let cli = Cli::try_parse_from(["tractor", "--require-plugin-ingest"]).expect("cli parse");
        assert_eq!(
            plugin_ingest_policy(&cli.daemon),
            PluginIngestPolicy::FailFast
        );
    }

    #[test]
    fn require_plugin_ingest_flag_allows_plugin_arguments() {
        let cli = Cli::try_parse_from([
            "tractor",
            "--require-plugin-ingest",
            "--plugin",
            "./plugins/pi-agent.wasm",
        ])
        .expect("cli parse");

        assert_eq!(
            plugin_ingest_policy(&cli.daemon),
            PluginIngestPolicy::FailFast
        );
        assert_eq!(cli.daemon.plugin.len(), 1);
    }

    #[tokio::test]
    async fn maybe_ingest_on_load_runs_with_plugin_fixture() {
        let config = TractorNativeConfig {
            namespace: ":memory:".to_string(),
            port: 0,
            security_mode: SecurityMode::None,
            ..Default::default()
        };

        let tractor = TractorNative::boot(config).await.expect("boot tractor");
        let fixture = std::path::Path::new("tests/fixtures/null-plugin.wasm");
        let mut handle = tractor
            .load_plugin(fixture)
            .await
            .expect("load fixture plugin");

        let result = maybe_ingest_on_load(
            &mut handle,
            fixture,
            PluginIngestPolicy::WarnAndContinue,
        )
        .await;
        assert!(result.is_ok(), "ingest-on-load should succeed: {result:?}");

        let metadata = handle.call_metadata().await.expect("metadata call");
        assert_eq!(metadata["name"], "null-plugin");

        tractor.shutdown().await.expect("shutdown tractor");
    }

    #[tokio::test]
    async fn runtime_boot_probe_succeeds_in_memory_namespace() {
        let result = probe_runtime_boot(":memory:").await;
        assert!(result.is_ok(), "boot probe should succeed: {result:?}");
    }

    #[tokio::test]
    async fn ws_probe_returns_error_when_daemon_is_unavailable() {
        let result = probe_ws_daemon(1, Duration::from_millis(200)).await;
        assert!(result.is_err(), "ws probe should fail when daemon is unavailable");
    }

    #[tokio::test]
    async fn ws_probe_succeeds_when_daemon_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind listener");
        let port = listener.local_addr().expect("listener local addr").port();

        let storage = NativeStorage::open(":memory:").expect("open storage");
        let sync = Arc::new(NativeSync::new(storage, "health-probe").expect("new sync"));
        let telemetry = TelemetryBus::new(10);
        let channels: AgentChannels = Arc::new(std::sync::RwLock::new(std::collections::HashMap::new()));
        let server = daemon::WsServer::new(sync, port, telemetry, channels);

        tokio::spawn(async move {
            let _ = server.run(listener).await;
        });
        tokio::time::sleep(Duration::from_millis(50)).await;

        let result = probe_ws_daemon(port, Duration::from_millis(500)).await;
        assert!(result.is_ok(), "ws probe should succeed when daemon is listening: {result:?}");
    }
}
