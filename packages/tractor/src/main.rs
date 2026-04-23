//! tractor-native daemon + CLI helpers
//!
//! Default mode (no subcommand): starts the WebSocket daemon on port 42000.
//! Additional utility subcommands:
//!   - `prompt`: send `user:prompt` JSON over WS and optionally wait for AgentResponse
//!   - `watch`:  poll storage and print new AgentResponse records

use std::collections::HashSet;

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use tokio::time::{sleep, Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tractor::{
    NativeStorage, TractorNative, TractorNativeConfig,
    trust::SecurityMode,
};

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
}

#[derive(Args, Debug)]
struct WatchArgs {
    /// Namespace to read (`~/.local/share/refarm/{namespace}.db`)
    #[arg(long, default_value = "default")]
    namespace: String,

    /// Filter by source_plugin (e.g. pi-agent). Empty = all.
    #[arg(long, default_value = "pi-agent")]
    agent: String,

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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Command::Prompt(args)) => run_prompt(args).await,
        Some(Command::Watch(args)) => run_watch(args).await,
        None => run_daemon(cli.daemon).await,
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

    let tractor = TractorNative::boot(config.clone()).await?;

    let load_policy = plugin_load_policy(&args);
    for path in &args.plugin {
        match tractor.load_plugin(path).await {
            Ok(handle) => {
                tracing::info!(path = %path.display(), plugin_id = %handle.id, "plugin loaded");
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

async fn run_prompt(args: PromptArgs) -> Result<()> {
    let mut seen = snapshot_seen_response_ids(&args.namespace, &args.agent)?;
    send_user_prompt(args.ws_port, &args.agent, &args.payload).await?;

    println!(
        "prompt sent: agent={} ws_port={} namespace={}",
        args.agent, args.ws_port, args.namespace
    );

    if args.wait_timeout_ms == 0 {
        return Ok(());
    }

    let got_final = poll_agent_responses(
        &args.namespace,
        &args.agent,
        &mut seen,
        Duration::from_millis(args.poll_interval_ms.max(50)),
        Some(Duration::from_millis(args.wait_timeout_ms)),
        false,
        true,
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
    let mut seen = snapshot_seen_response_ids(&args.namespace, &args.agent)?;
    let timeout = if args.timeout_ms == 0 {
        None
    } else {
        Some(Duration::from_millis(args.timeout_ms))
    };

    let _ = poll_agent_responses(
        &args.namespace,
        &args.agent,
        &mut seen,
        Duration::from_millis(args.poll_interval_ms.max(50)),
        timeout,
        args.once,
        args.until_final,
    )
    .await?;

    Ok(())
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

        out.push(AgentResponseEvent {
            id: row.id,
            source_plugin: row.source_plugin,
            updated_at: row.updated_at,
            sequence,
            is_final,
            prompt_ref,
            content,
            timestamp_ns,
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

async fn poll_agent_responses(
    namespace: &str,
    agent_filter: &str,
    seen: &mut HashSet<String>,
    poll_interval: Duration,
    timeout: Option<Duration>,
    stop_after_first: bool,
    stop_on_final: bool,
) -> Result<bool> {
    let deadline = timeout.map(|d| Instant::now() + d);

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

            if event.is_final {
                got_final = true;
            }

            if stop_after_first {
                return Ok(got_final);
            }
        }

        if stop_on_final && got_final {
            return Ok(true);
        }

        sleep(poll_interval).await;
    }
}

// Bring daemon module into scope for main.rs
use tractor::daemon;

#[cfg(test)]
mod tests {
    use super::*;

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
}
