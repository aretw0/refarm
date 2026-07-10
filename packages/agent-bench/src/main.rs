//! agent-token-bench — a token regression-net for the agent.
//!
//! Mirrors `tractor-bench` (baseline JSON + percentage threshold + GHA payload)
//! but the metric is TOKENS, not latency. It drives the real `agent.wasm` through
//! a deterministic scenario against a mock LLM with KNOWN token counts, reads the
//! `UsageRecord` the agent persists, and compares the token totals to a committed
//! baseline. If a change inflates the tokens the agent sends/receives for the same
//! work (e.g. prompt caching silently stops marking, or context injection regresses
//! back toward dumping content), the check fails — the "sense regression by score"
//! net the audit found missing for the agent.
//!
//! Subcommands (like tractor-bench):
//!   save   — run the scenario and write the baseline
//!   check  — run the scenario and fail if any metric regressed past its threshold
//!
//! Because the token counts come from the mock LLM (fixed), the *interesting* signal
//! is the DELTA the agent adds: how many turns it takes, and — once real tokenizer
//! accounting lands — how much prefix it re-sends. Today the scenario proves the
//! wiring end-to-end and guards the turn/usage-record shape; the metric set is
//! designed to grow (add a "prefix bytes" metric when caching accounting is read).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tractor::host::PluginHost;
use tractor::trust::TrustManager;
use tractor::{NativeStorage, NativeSync, TelemetryBus};

const BASELINE_PATH: &str = "benchmarks/baseline-tokens.json";
const CURRENT_PATH: &str = "benchmarks/current-tokens.json";
const GHA_PAYLOAD_PATH: &str = "benchmarks/gha-payload-tokens.json";
const REGRESSION_THRESHOLD_PCT: f64 = 20.0;

/// The scripted token counts the mock LLM reports. Deterministic so the baseline is
/// stable; the bench guards that the agent records exactly these and does not add
/// extra turns/usage beyond the scenario.
const MOCK_TOKENS_IN: u32 = 120;
const MOCK_TOKENS_OUT: u32 = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchReport {
    version: u8,
    suite: String,
    threshold_pct: f64,
    metrics: Vec<BenchMetric>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchMetric {
    name: String,
    value: u128,
    unit: String,
    lower_is_better: bool,
    threshold_pct: f64,
}

#[derive(Debug, Serialize)]
struct GhaPayload {
    improved: bool,
    regressed: bool,
    diff: f64,
    threshold: f64,
    metric: String,
    baseline_value: u128,
    current_value: u128,
}

#[tokio::main]
async fn main() -> Result<()> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "check".to_string());
    let report = run_scenario().await?;
    match mode.as_str() {
        "save" => {
            write_json(BASELINE_PATH, &report)?;
            println!(
                "[agent-token-bench] baseline saved: {} metrics",
                report.metrics.len()
            );
            for m in &report.metrics {
                println!("  {} = {} {}", m.name, m.value, m.unit);
            }
            Ok(())
        }
        "check" => {
            write_json(CURRENT_PATH, &report)?;
            check_against_baseline(&report)
        }
        other => Err(anyhow!(
            "unknown mode {other:?} — use `save` or `check`"
        )),
    }
}

/// Drive the real agent.wasm through one deterministic prompt and collect the token
/// metrics from the persisted UsageRecord.
async fn run_scenario() -> Result<BenchReport> {
    let path = wasm_path();
    if !path.exists() {
        return Err(anyhow!(
            "agent.wasm not found at {} — build it first (cargo component build --release -p agent)",
            path.display()
        ));
    }

    clean_model_env();
    let port = mock_llm_server(openai_response("bench response", MOCK_TOKENS_IN, MOCK_TOKENS_OUT));
    std::env::set_var("MODEL_PROVIDER", "ollama");
    std::env::set_var("MODEL_BASE_URL", format!("http://127.0.0.1:{port}"));

    let storage = NativeStorage::open(":memory:").context("open storage")?;
    let sync = NativeSync::new(storage, ":memory:").context("open sync")?;
    let host = PluginHost::new(
        TrustManager::new(),
        TelemetryBus::new(100),
        tractor::host::DEFAULT_ON_EVENT_BUDGET_MS,
    )
    .map_err(|e| anyhow!("PluginHost::new: {e}"))?;
    let mut handle = host.load(&path, &sync).await.map_err(|e| anyhow!("load agent: {e}"))?;

    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        handle.call_on_event("user:prompt", Some("bench: summarize the plan")),
    )
    .await
    .map_err(|_| anyhow!("on_event timed out"))?
    .map_err(|e| anyhow!("on_event failed: {e}"))?;

    let usage_records = sync
        .query_nodes("UsageRecord")
        .map_err(|e| anyhow!("query UsageRecord: {e}"))?;
    clean_model_env();

    if usage_records.is_empty() {
        return Err(anyhow!("no UsageRecord persisted — the agent recorded no usage"));
    }

    // Aggregate token totals across all usage records (the scenario is one turn, so
    // this is the single record today; summing keeps it correct if the scenario grows).
    let mut tokens_in: u128 = 0;
    let mut tokens_out: u128 = 0;
    for node in &usage_records {
        let v: serde_json::Value = serde_json::from_str(&node.payload).context("parse UsageRecord")?;
        tokens_in += v["tokens_in"].as_u64().unwrap_or(0) as u128;
        tokens_out += v["tokens_out"].as_u64().unwrap_or(0) as u128;
    }

    Ok(BenchReport {
        version: 1,
        suite: "agent-tokens".to_string(),
        threshold_pct: REGRESSION_THRESHOLD_PCT,
        metrics: vec![
            BenchMetric {
                name: "tokens_in".to_string(),
                value: tokens_in,
                unit: "tokens".to_string(),
                lower_is_better: true,
                threshold_pct: REGRESSION_THRESHOLD_PCT,
            },
            BenchMetric {
                name: "tokens_out".to_string(),
                value: tokens_out,
                unit: "tokens".to_string(),
                lower_is_better: true,
                threshold_pct: REGRESSION_THRESHOLD_PCT,
            },
            BenchMetric {
                name: "usage_records".to_string(),
                value: usage_records.len() as u128,
                unit: "records".to_string(),
                lower_is_better: true,
                threshold_pct: REGRESSION_THRESHOLD_PCT,
            },
        ],
    })
}

/// Compare the current report to the committed baseline; fail if any metric where
/// `lower_is_better` grew past its threshold. Writes a GHA payload for the worst diff.
fn check_against_baseline(current: &BenchReport) -> Result<()> {
    let baseline: BenchReport = read_json(BASELINE_PATH).with_context(|| {
        format!("baseline {BASELINE_PATH} missing — run `save` first to establish it")
    })?;

    let mut worst: Option<GhaPayload> = None;
    let mut regressed = false;

    for cur in &current.metrics {
        let Some(base) = baseline.metrics.iter().find(|m| m.name == cur.name) else {
            println!("[agent-token-bench] new metric {} (no baseline) — skipping", cur.name);
            continue;
        };
        let base_v = base.value as f64;
        let cur_v = cur.value as f64;
        let diff_pct = if base_v == 0.0 {
            if cur_v == 0.0 { 0.0 } else { 100.0 }
        } else {
            ((cur_v - base_v) / base_v) * 100.0
        };
        // lower_is_better: a POSITIVE diff (grew) past the threshold is a regression.
        let metric_regressed = cur.lower_is_better && diff_pct > cur.threshold_pct;
        if metric_regressed {
            regressed = true;
        }
        let status = if metric_regressed {
            "REGRESSED"
        } else if diff_pct < 0.0 {
            "improved"
        } else {
            "ok"
        };
        println!(
            "[agent-token-bench] {} {}: {} → {} ({:+.1}%, threshold {:.0}%)",
            status, cur.name, base.value, cur.value, diff_pct, cur.threshold_pct
        );
        let candidate = GhaPayload {
            improved: diff_pct < 0.0,
            regressed: metric_regressed,
            diff: diff_pct,
            threshold: cur.threshold_pct,
            metric: cur.name.clone(),
            baseline_value: base.value,
            current_value: cur.value,
        };
        worst = Some(match worst {
            Some(w) if w.diff.abs() >= diff_pct.abs() => w,
            _ => candidate,
        });
    }

    if let Some(payload) = worst {
        write_json(GHA_PAYLOAD_PATH, &payload)?;
    }

    if regressed {
        Err(anyhow!(
            "token regression detected (a lower-is-better metric grew past its threshold)"
        ))
    } else {
        println!("[agent-token-bench] no token regression");
        Ok(())
    }
}

// ── the minimal harness subset (mirrors packages/tractor/tests/agent_harness.rs) ──

fn wasm_path() -> PathBuf {
    match std::env::var("CARGO_TARGET_DIR") {
        Ok(dir) => PathBuf::from(dir).join("wasm32-wasip1/release/agent.wasm"),
        Err(_) => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../agent/target/wasm32-wasip1/release/agent.wasm"),
    }
}

/// Reset the MODEL_* env so the scenario is hermetic.
fn clean_model_env() {
    for key in [
        "MODEL_PROVIDER",
        "MODEL_BASE_URL",
        "MODEL_ID",
        "MODEL_SYSTEM",
        "MODEL_PROMPT_CACHE",
        "MODEL_MAX_TOKENS",
        "MODEL_TOOL_CALL_MAX_ITER",
        "MODEL_HISTORY_TURNS",
    ] {
        std::env::remove_var(key);
    }
}

fn openai_response(content: &str, tokens_in: u32, tokens_out: u32) -> serde_json::Value {
    serde_json::json!({
        "id": "bench-mock",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": tokens_in, "completion_tokens": tokens_out, "total_tokens": tokens_in + tokens_out}
    })
}

/// One-shot mock LLM server: returns `body` for any POST until the process ends.
fn mock_llm_server(body: serde_json::Value) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let body_str = body.to_string();
    std::thread::spawn(move || {
        while let Ok((mut stream, _)) = listener.accept() {
            let _ = read_http_request(&mut stream);
            let _ = write_http_response(&mut stream, &body_str);
        }
    });
    port
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

fn write_json<T: Serialize>(path: &str, value: &T) -> Result<()> {
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(value)?;
    std::fs::write(path, json).with_context(|| format!("write {path}"))?;
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
    Ok(serde_json::from_str(&raw)?)
}
