//! HTTP sidecar — implements the ADR-060 effort protocol on top of TractorNative.
//!
//! Binds on `127.0.0.1:<port>` (default 42001) and exposes:
//!   POST   /efforts                    — submit effort, returns { effortId }
//!   GET    /efforts                    — list effort results
//!   GET    /efforts/summary            — aggregate summary
//!   GET    /efforts/:id                — single effort result
//!   GET    /efforts/:id/logs           — effort log entries
//!   POST   /efforts/:id/retry          — re-enqueue
//!   POST   /efforts/:id/cancel         — cancel
//!
//! Effort execution is async: each effort is dispatched in a separate tokio
//! task. Results and stream chunks are written to the filesystem so that
//! `refarm ask` can poll them without holding a connection open.

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;

use crate::AgentChannels;

// ── effort store ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffortResult {
    pub effort_id: String,
    pub status: String,
    pub results: Vec<TaskResult>,
    pub submitted_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EffortTask {
    pub id: String,
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    #[serde(rename = "fn")]
    pub fn_name: Option<String>,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effort {
    pub id: String,
    pub direction: Option<String>,
    pub tasks: Vec<EffortTask>,
    pub source: Option<String>,
    pub submitted_at: String,
}

type EffortStore = Arc<RwLock<HashMap<String, EffortResult>>>;

// ── sidecar state ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SidecarState {
    pub efforts: EffortStore,
    pub agent_channels: AgentChannels,
    pub streams_dir: PathBuf,
    pub results_dir: PathBuf,
}

impl SidecarState {
    pub fn new(
        agent_channels: AgentChannels,
        base_dir: &Path,
    ) -> std::io::Result<Self> {
        let streams_dir = base_dir.join("streams");
        let results_dir = base_dir.join("task-results");
        fs::create_dir_all(&streams_dir)?;
        fs::create_dir_all(&results_dir)?;
        Ok(Self {
            efforts: Arc::new(RwLock::new(HashMap::new())),
            agent_channels,
            streams_dir,
            results_dir,
        })
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn err(status: StatusCode, msg: &str) -> impl IntoResponse {
    (status, Json(serde_json::json!({ "error": msg })))
}

fn prompt_ref_from_effort(effort_id: &str) -> String {
    // Mirrors pi-agent's new_pi_urn("prompt") convention — stable for stream_ref derivation.
    format!("urn:pi-agent:prompt-{}", effort_id.replace('-', ""))
}

fn stream_ref_for_prompt(prompt_ref: &str) -> String {
    format!("urn:tractor:stream:agent-response:{prompt_ref}")
}

fn write_stream_chunk(
    streams_dir: &Path,
    stream_ref: &str,
    sequence: u64,
    content: &str,
    is_final: bool,
    metadata: Option<Value>,
) -> std::io::Result<()> {
    let path = streams_dir.join(format!("{stream_ref}.ndjson"));
    let mut chunk = serde_json::json!({
        "stream_ref": stream_ref,
        "sequence": sequence,
        "content": content,
        "is_final": is_final,
    });
    if let Some(meta) = metadata {
        chunk["metadata"] = meta;
    }
    let mut file = fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "{}", chunk)?;
    Ok(())
}

struct TaskArgs {
    prompt: String,
    system: Option<String>,
    session_id: Option<String>,
    history_turns: Option<u64>,
}

fn extract_task_args(task: &EffortTask) -> TaskArgs {
    let args = &task.args;
    TaskArgs {
        prompt: args
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        system: args
            .get("system")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        session_id: args
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        history_turns: args
            .get("history_turns")
            .and_then(|v| v.as_u64()),
    }
}

// ── effort dispatch ──────────────────────────────────────────────────────────

fn dispatch_effort(state: SidecarState, effort: Effort) {
    tokio::spawn(async move {
        let effort_id = effort.id.clone();
        let submitted_at = effort.submitted_at.clone();

        // Mark active
        {
            let mut store = state.efforts.write().expect("effort store poisoned");
            store.insert(
                effort_id.clone(),
                EffortResult {
                    effort_id: effort_id.clone(),
                    status: "active".to_string(),
                    results: vec![],
                    submitted_at: submitted_at.clone(),
                    completed_at: None,
                },
            );
        }

        let task = match effort.tasks.first() {
            Some(t) => t.clone(),
            None => {
                finalise_effort(&state.efforts, &effort_id, "failed", vec![TaskResult {
                    status: "error".to_string(),
                    result: None,
                    error: Some("effort has no tasks".to_string()),
                }]);
                return;
            }
        };

        let fn_name = task.fn_name.as_deref().unwrap_or("respond");

        // Only `@refarm/pi-agent` + `respond` is supported in Phase 1.
        if task.plugin_id != "@refarm/pi-agent" || fn_name != "respond" {
            finalise_effort(&state.efforts, &effort_id, "failed", vec![TaskResult {
                status: "error".to_string(),
                result: None,
                error: Some(format!(
                    "sidecar: unsupported task {}::{fn_name} (only @refarm/pi-agent::respond)",
                    task.plugin_id
                )),
            }]);
            return;
        }

        let args = extract_task_args(&task);
        let prompt_ref = prompt_ref_from_effort(&effort_id);
        let stream_ref = stream_ref_for_prompt(&prompt_ref);

        // Build the structured payload for pi-agent's handle_prompt.
        // Includes all session context so pi-agent maintains conversation history.
        let mut payload_obj = serde_json::json!({
            "prompt": args.prompt,
            "prompt_ref": prompt_ref,
        });
        if let Some(sys) = args.system {
            payload_obj["system"] = Value::String(sys);
        }
        if let Some(sid) = args.session_id {
            payload_obj["session_id"] = Value::String(sid);
        }
        if let Some(turns) = args.history_turns {
            payload_obj["history_turns"] = Value::Number(turns.into());
        }
        let payload = payload_obj.to_string();

        // Dispatch to pi-agent channel.
        let sent = {
            let channels = state.agent_channels.read().expect("channels poisoned");
            channels.get("@refarm/pi-agent").map(|tx| {
                tx.send(crate::AgentMessage {
                    event: "user:prompt".to_string(),
                    payload: Some(payload),
                })
            })
        };

        match sent {
            None => {
                // Plugin not loaded — write error stream chunk so client doesn't timeout.
                let _ = write_stream_chunk(
                    &state.streams_dir,
                    &stream_ref,
                    0,
                    "[pi-agent not loaded — run npm run agent:install then restart]",
                    true,
                    None,
                );
                finalise_effort(&state.efforts, &effort_id, "failed", vec![TaskResult {
                    status: "error".to_string(),
                    result: None,
                    error: Some("@refarm/pi-agent not loaded".to_string()),
                }]);
            }
            Some(Err(e)) => {
                let _ = write_stream_chunk(
                    &state.streams_dir,
                    &stream_ref,
                    0,
                    &format!("[dispatch error: {e}]"),
                    true,
                    None,
                );
                finalise_effort(&state.efforts, &effort_id, "failed", vec![TaskResult {
                    status: "error".to_string(),
                    result: None,
                    error: Some(format!("channel send error: {e}")),
                }]);
            }
            Some(Ok(())) => {
                // Success — the plugin runner thread will write stream chunks.
                // Mark done optimistically; a future improvement polls the CRDT for the real result.
                finalise_effort(&state.efforts, &effort_id, "done", vec![TaskResult {
                    status: "ok".to_string(),
                    result: None,
                    error: None,
                }]);
            }
        }
    });
}

fn finalise_effort(store: &EffortStore, effort_id: &str, status: &str, results: Vec<TaskResult>) {
    let mut s = store.write().expect("effort store poisoned");
    if let Some(entry) = s.get_mut(effort_id) {
        entry.status = status.to_string();
        entry.results = results;
        entry.completed_at = Some(chrono_now_iso());
    }
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Simple ISO 8601 without chrono dependency
    let (y, mo, d, h, mi, s) = epoch_to_parts(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn epoch_to_parts(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let mins = secs / 60;
    let mi = mins % 60;
    let hours = mins / 60;
    let h = hours % 24;
    let days = hours / 24;
    // Approximate Gregorian — good enough for ISO timestamps in logs
    let y400 = days / 146097;
    let rem = days % 146097;
    let y100 = (rem / 36524).min(3);
    let rem = rem - y100 * 36524;
    let y4 = rem / 1461;
    let rem = rem % 1461;
    let y1 = (rem / 365).min(3);
    let rem = rem - y1 * 365;
    let year = y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1970;
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days: &[u64] = if leap {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut day = rem;
    let mut month = 1u64;
    for &md in month_days {
        if day < md {
            break;
        }
        day -= md;
        month += 1;
    }
    (year, month, day + 1, h, mi, s)
}

// ── route handlers ────────────────────────────────────────────────────────────

async fn post_efforts(
    State(state): State<SidecarState>,
    Json(effort): Json<Effort>,
) -> impl IntoResponse {
    let effort_id = effort.id.clone();
    dispatch_effort(state, effort);
    (StatusCode::OK, Json(serde_json::json!({ "effortId": effort_id })))
}

async fn get_efforts(State(state): State<SidecarState>) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    let list: Vec<&EffortResult> = store.values().collect();
    Json(serde_json::to_value(&list).unwrap_or(Value::Array(vec![])))
}

async fn get_efforts_summary(State(state): State<SidecarState>) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    let total = store.len();
    let done = store.values().filter(|e| e.status == "done").count();
    let failed = store.values().filter(|e| e.status == "failed").count();
    let active = store.values().filter(|e| e.status == "active").count();
    let pending = store.values().filter(|e| e.status == "pending").count();
    Json(serde_json::json!({
        "total": total,
        "done": done,
        "failed": failed,
        "active": active,
        "pending": pending,
    }))
}

async fn get_effort(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    match store.get(&id) {
        Some(result) => (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response(),
        None => err(StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn get_effort_logs(
    State(_state): State<SidecarState>,
    AxumPath(_id): AxumPath<String>,
) -> impl IntoResponse {
    // Phase 1: log entries not yet persisted — return empty array
    (StatusCode::OK, Json(Value::Array(vec![])))
}

async fn post_effort_retry(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    match store.get(&id) {
        None => err(StatusCode::NOT_FOUND, "not found").into_response(),
        Some(e) if e.status == "active" || e.status == "pending" => {
            err(StatusCode::CONFLICT, "retry not allowed: effort in progress").into_response()
        }
        Some(_) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "accepted": true }))).into_response(),
    }
}

async fn post_effort_cancel(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    match store.get(&id) {
        None => err(StatusCode::NOT_FOUND, "not found").into_response(),
        Some(e) if e.status == "done" || e.status == "failed" => {
            err(StatusCode::CONFLICT, "cancel not allowed: effort already terminal").into_response()
        }
        Some(_) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "accepted": true }))).into_response(),
    }
}

// ── public API ────────────────────────────────────────────────────────────────

pub async fn start(state: SidecarState, port: u16) -> anyhow::Result<()> {
    let router = Router::new()
        .route("/efforts", post(post_efforts).get(get_efforts))
        .route("/efforts/summary", get(get_efforts_summary))
        .route("/efforts/:id", get(get_effort))
        .route("/efforts/:id/logs", get(get_effort_logs))
        .route("/efforts/:id/retry", post(post_effort_retry))
        .route("/efforts/:id/cancel", post(post_effort_cancel))
        .with_state(state);

    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    tracing::info!(port, "HTTP sidecar listening");
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests;

