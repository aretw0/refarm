//! HTTP sidecar — implements the ADR-060 effort protocol on top of TractorNative.
//!
//! Binds on the configured host and port (`127.0.0.1:42001` by default) and exposes:
//!   POST   /efforts                    — submit effort, returns { effortId }
//!   GET    /efforts                    — list effort results
//!   GET    /efforts/summary            — aggregate summary
//!   GET    /efforts/:id                — single effort result
//!   GET    /efforts/:id/logs           — effort log entries
//!   POST   /efforts/:id/retry          — re-enqueue
//!   POST   /efforts/:id/cancel         — cancel
//!   GET    /plugins                    — installed/loaded plugin state
//!   POST   /plugins/reload             — report reload readiness for loaded plugins
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
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;

use crate::PluginChannels;

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

// ── effort status vocabulary ──────────────────────────────────────────────────
//
// Mirrors `EffortStatus` in @refarm.dev/effort-contract-v1. The sidecar stores
// status as a bare String (wire-facing JSON), so these constants are the single
// Rust source of truth — do not write status literals inline.
//
//   pending     — recorded, not yet started
//   in-progress — the sidecar's own work is running (a dispatch task is live)
//   done        — the effort OWNS a completed task result (respond, once landed)
//   delivered   — a dispatch event was accepted by a subscriber; the effort's
//                 whole job (delivery) is complete, the verb RESULT lives out of
//                 band as a dispatch-result:v1 node read back by replyRef
//   failed      — no subscriber / send error / no tasks
//   cancelled   — cancelled before reaching another terminal state
//
// `active` is NOT a contract status — it was legacy sidecar vocabulary that lied
// (it read as in-progress but consumers had no such state). Replaced by
// EFFORT_IN_PROGRESS.
pub(crate) const EFFORT_PENDING: &str = "pending";
pub(crate) const EFFORT_IN_PROGRESS: &str = "in-progress";
pub(crate) const EFFORT_DONE: &str = "done";
pub(crate) const EFFORT_DELIVERED: &str = "delivered";
pub(crate) const EFFORT_FAILED: &str = "failed";
pub(crate) const EFFORT_CANCELLED: &str = "cancelled";

/// Terminal statuses — no further transitions except via retry(). Mirrors
/// EFFORT_TERMINAL_STATES in the TS contract. `delivered` is terminal and honest:
/// unlike `done` it carries only a delivery receipt (the verb result is an
/// out-of-band node), so the effort has nothing left to do and watch loops stop.
pub(crate) fn is_terminal_effort_status(status: &str) -> bool {
    matches!(
        status,
        EFFORT_DONE
            | EFFORT_DELIVERED
            | "partial"
            | EFFORT_FAILED
            | "timed-out"
            | EFFORT_CANCELLED
    )
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
    /// The original submitted Effort (tasks/args), retained so retry can
    /// re-dispatch it. The `efforts` store above keeps only EffortResult, which
    /// has no tasks. In-process only: this map starts empty on boot and is not
    /// persisted — retry re-runs an effort submitted during THIS sidecar
    /// lifetime; after a restart the input is gone and retry reports so.
    pub efforts_input: Arc<RwLock<HashMap<String, Effort>>>,
    pub plugin_channels: PluginChannels,
    /// Per-plugin cancel flags shared with each plugin store's epoch callback.
    /// Setting one force-interrupts that plugin's in-flight guest call — how
    /// effort-cancel reaches a thread already spinning inside a guest (the mpsc
    /// plugin_channels cannot: a wedged thread never polls its receiver).
    pub cancel_flags: crate::CancelFlags,
    /// Per-prompt_ref cancel flags — the SPECIFIC store running each prompt. Lets
    /// effort-cancel force-interrupt exactly the store executing the target
    /// effort, even under a store pool (N stores draining one queue). Populated by
    /// the runner threads (crate::InFlightCancels).
    pub in_flight_cancels: crate::InFlightCancels,
    /// ID of the loaded plugin with `"agent:respond"` capability, if any.
    /// Populated by TractorNative.register_for_events; used for effort routing.
    pub active_agent_id: Arc<RwLock<Option<String>>>,
    /// The neutral event router — lets a non-`respond` effort dispatch to any
    /// subscribed plugin by event, not just the elected agent's `user:prompt`.
    pub event_router: crate::EventRouter,
    /// Telemetry bus, so the effort dispatcher's router deliveries are observable.
    pub telemetry: crate::TelemetryBus,
    pub streams_dir: PathBuf,
    pub results_dir: PathBuf,
    pub namespace: String,
    /// Respond-watcher timeout + poll cadence, resolved from env ONCE at boot
    /// (see RespondWatchConfig). The watcher reads these off the state, not env —
    /// so tests set a short timeout by overriding the field, never set_var.
    pub respond_watch: RespondWatchConfig,
}

/// Timeout + poll cadence (ms) for the respond watcher. Resolved from env ONCE
/// at SidecarState construction; carried on the state so the watcher reads a
/// value, not process env (which leaks across threads under --test-threads>1).
#[derive(Debug, Clone, Copy)]
pub struct RespondWatchConfig {
    pub timeout_ms: u64,
    pub interval_ms: u64,
}

impl Default for RespondWatchConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 45_000,
            interval_ms: 100,
        }
    }
}

impl RespondWatchConfig {
    /// Resolve the respond-watch knobs from env. Called ONCE at SidecarState::new.
    pub fn from_env() -> Self {
        Self {
            timeout_ms: dispatch::respond_watch_timeout_ms_from_env(),
            interval_ms: dispatch::respond_watch_interval_ms_from_env(),
        }
    }
}

impl SidecarState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        plugin_channels: PluginChannels,
        cancel_flags: crate::CancelFlags,
        in_flight_cancels: crate::InFlightCancels,
        active_agent_id: Arc<RwLock<Option<String>>>,
        event_router: crate::EventRouter,
        telemetry: crate::TelemetryBus,
        base_dir: &Path,
        namespace: String,
    ) -> std::io::Result<Self> {
        let streams_dir = base_dir.join("streams");
        let results_dir = base_dir.join("task-results");
        fs::create_dir_all(&streams_dir)?;
        fs::create_dir_all(&results_dir)?;
        let efforts = load_persisted_efforts(&results_dir);
        Ok(Self {
            efforts: Arc::new(RwLock::new(efforts)),
            efforts_input: Arc::new(RwLock::new(HashMap::new())),
            plugin_channels,
            cancel_flags,
            in_flight_cancels,
            active_agent_id,
            event_router,
            telemetry,
            streams_dir,
            results_dir,
            namespace,
            respond_watch: RespondWatchConfig::from_env(),
        })
    }
}

fn effort_result_path(results_dir: &Path, effort_id: &str) -> PathBuf {
    results_dir.join(format!("{}.json", safe_effort_result_filename(effort_id)))
}

fn safe_effort_result_filename(effort_id: &str) -> String {
    let filename: String = effort_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if filename.is_empty() {
        "unknown".to_string()
    } else {
        filename
    }
}

fn load_persisted_efforts(results_dir: &Path) -> HashMap<String, EffortResult> {
    let mut efforts = HashMap::new();
    let Ok(entries) = fs::read_dir(results_dir) else {
        return efforts;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            tracing::warn!(path = %path.display(), "sidecar: failed to read persisted effort");
            continue;
        };
        match serde_json::from_str::<EffortResult>(&content) {
            Ok(result) => {
                efforts.insert(result.effort_id.clone(), result);
            }
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "sidecar: ignored invalid persisted effort");
            }
        }
    }
    efforts
}

fn persist_effort_result(results_dir: &Path, result: &EffortResult) -> std::io::Result<()> {
    let path = effort_result_path(results_dir, &result.effort_id);
    let tmp_path = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(result)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(&tmp_path, body)?;
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn record_effort_result(state: &SidecarState, result: EffortResult) {
    {
        let mut store = state.efforts.write().expect("effort store poisoned");
        store.insert(result.effort_id.clone(), result.clone());
    }
    if let Err(error) = persist_effort_result(&state.results_dir, &result) {
        tracing::warn!(
            effort_id = %result.effort_id,
            %error,
            "sidecar: failed to persist effort result"
        );
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn err(status: StatusCode, msg: &str) -> impl IntoResponse {
    (status, Json(serde_json::json!({ "error": msg })))
}

fn prompt_ref_from_effort(effort_id: &str) -> String {
    // Mirrors agent's new_agent_urn("prompt") convention — stable for stream_ref derivation.
    format!("urn:agent:prompt-{}", effort_id.replace('-', ""))
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
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{}", chunk)?;
    Ok(())
}

async fn get_plugins(State(state): State<SidecarState>) -> impl IntoResponse {
    let loaded: Vec<String> = {
        let channels = state.plugin_channels.read().expect("channels poisoned");
        let mut ids: Vec<String> = channels.keys().cloned().collect();
        ids.sort();
        ids
    };
    let active_agent = state
        .active_agent_id
        .read()
        .expect("active_agent_id poisoned")
        .clone();

    Json(serde_json::json!({
        "installed": loaded,
        "loaded": loaded,
        "local": [],
        "known": loaded,
        "activeAgent": active_agent,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginReloadRequest {
    plugin_ids: Option<Vec<String>>,
}

/// Reports which requested plugins are currently loaded (reload readiness). This
/// endpoint does NOT itself swap plugin code — the sidecar holds only the shared
/// channel/router Arcs, not the plugin host. Real hot-reload is
/// TractorNative::reload_plugin (unregister + load fresh bytes + register), which
/// lives on the host that owns load/unregister; wiring this endpoint to call it
/// is a follow-on that must reach the host without re-coupling the sidecar.
async fn post_plugins_reload(
    State(state): State<SidecarState>,
    Json(request): Json<PluginReloadRequest>,
) -> impl IntoResponse {
    let loaded: Vec<String> = {
        let channels = state.plugin_channels.read().expect("channels poisoned");
        let mut ids: Vec<String> = channels.keys().cloned().collect();
        ids.sort();
        ids
    };
    let requested = request.plugin_ids.unwrap_or_else(|| loaded.clone());
    let mut reloaded = Vec::new();
    let mut skipped = Vec::new();

    for plugin_id in requested {
        if loaded.contains(&plugin_id) {
            reloaded.push(plugin_id);
        } else {
            skipped.push(plugin_id);
        }
    }

    Json(serde_json::json!({
        "reloadId": uuid::Uuid::new_v4().to_string(),
        "reloaded": reloaded,
        "deferred": [],
        "skipped": skipped,
    }))
}

mod dispatch;
pub(crate) use dispatch::*;
mod reap;
async fn post_efforts(
    State(state): State<SidecarState>,
    Json(effort): Json<Effort>,
) -> impl IntoResponse {
    let effort_id = effort.id.clone();
    dispatch_effort(state, effort);
    (
        StatusCode::OK,
        Json(serde_json::json!({ "effortId": effort_id })),
    )
}

async fn get_efforts(State(state): State<SidecarState>) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    let list: Vec<&EffortResult> = store.values().collect();
    Json(serde_json::to_value(&list).unwrap_or(Value::Array(vec![])))
}

async fn get_efforts_summary(State(state): State<SidecarState>) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    let total = store.len();
    let count = |status: &str| store.values().filter(|e| e.status == status).count();
    Json(serde_json::json!({
        "total": total,
        "pending": count(EFFORT_PENDING),
        "inProgress": count(EFFORT_IN_PROGRESS),
        "done": count(EFFORT_DONE),
        "delivered": count(EFFORT_DELIVERED),
        "failed": count(EFFORT_FAILED),
        "cancelled": count(EFFORT_CANCELLED),
    }))
}

async fn get_effort(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let store = state.efforts.read().expect("effort store poisoned");
    match store.get(&id) {
        Some(result) => {
            (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response()
        }
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
    // Read the current status under a short-lived lock, then release it before
    // dispatching (dispatch_effort takes its own write locks).
    let status = {
        let store = state.efforts.read().expect("effort store poisoned");
        store.get(&id).map(|e| e.status.clone())
    };
    match status {
        None => err(StatusCode::NOT_FOUND, "not found").into_response(),
        Some(status) if !is_terminal_effort_status(&status) => err(
            StatusCode::CONFLICT,
            "retry not allowed: effort not yet terminal",
        )
        .into_response(),
        Some(_) => {
            // Re-dispatch the retained original Effort. The input map holds it only
            // for efforts submitted during this sidecar lifetime; after a restart
            // it is gone (results are durable, inputs are not) — report that
            // honestly with 409 rather than a fake accepted:true that never runs.
            let effort = {
                let inputs = state.efforts_input.read().expect("efforts_input poisoned");
                inputs.get(&id).cloned()
            };
            match effort {
                Some(effort) => {
                    dispatch_effort(state.clone(), effort);
                    (
                        StatusCode::ACCEPTED,
                        Json(serde_json::json!({ "accepted": true, "effortId": id })),
                    )
                        .into_response()
                }
                None => err(
                    StatusCode::CONFLICT,
                    "retry not possible: original effort was not retained (submitted before restart)",
                )
                .into_response(),
            }
        }
    }
}

/// Force-interrupt the store currently executing this effort by flipping its
/// cancel flag. Precise: derives the effort's prompt_ref (the same key a runner
/// registers when it starts running that prompt) and flips ONLY that store's
/// flag — so under a store pool the cancel interrupts the one worker running the
/// target effort, not its neighbours running unrelated events. Only the respond
/// family carries a prompt_ref and can sit in-progress awaiting cancel; a
/// terminal-on-delivery event dispatch never reaches this (the guard refuses a
/// terminal effort). Falls back to the per-plugin flag for any legacy path.
fn interrupt_effort_plugin(state: &SidecarState, effort_id: &str) {
    // Precise effort→store: the runner registered its store's cancel flag under
    // this effort's prompt_ref while running it.
    let prompt_ref = prompt_ref_from_effort(effort_id);
    if let Some(flag) = state
        .in_flight_cancels
        .read()
        .expect("in_flight_cancels poisoned")
        .get(&prompt_ref)
    {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
        tracing::info!(effort_id, %prompt_ref, "cancel force-interrupt: in-flight store flag set");
        return;
    }

    // Fallback: no in-flight prompt registered (e.g. the effort isn't mid-call).
    // Flip the plugin-level flag(s) as a best-effort, harmless if idle.
    let mut targets: Vec<String> = Vec::new();
    if let Some(effort) = state
        .efforts_input
        .read()
        .expect("efforts_input poisoned")
        .get(effort_id)
    {
        if let Some(task) = effort.tasks.first() {
            let key = task.plugin_id.rsplit('/').next().unwrap_or(&task.plugin_id);
            targets.push(key.to_string());
            targets.push(task.plugin_id.clone());
        }
    }
    if let Some(agent) = state
        .active_agent_id
        .read()
        .expect("active_agent_id poisoned")
        .clone()
    {
        targets.push(agent);
    }
    let flags = state.cancel_flags.read().expect("cancel_flags poisoned");
    for target in targets {
        if let Some(flag) = flags.get(&target) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
            tracing::info!(effort_id, plugin_id = %target, "cancel force-interrupt: plugin flag set (fallback)");
        }
    }
}

async fn post_effort_cancel(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    // Read the current status under a short-lived lock, then release it before
    // finalising (finalise_effort takes its own write lock).
    let current = {
        let store = state.efforts.read().expect("effort store poisoned");
        store.get(&id).map(|e| e.status.clone())
    };
    match current {
        None => err(StatusCode::NOT_FOUND, "not found").into_response(),
        Some(status) if is_terminal_effort_status(&status) => err(
            StatusCode::CONFLICT,
            "cancel not allowed: effort already terminal",
        )
        .into_response(),
        Some(_) => {
            // Force-interrupt a guest that may be spinning inside this effort's
            // handler: flip the target plugin's cancel flag. Its store epoch
            // callback traps at the next tick (~1ms via the global ticker),
            // unwinding the wedged call — this is what the store-level cancel
            // alone could not do (a wedged thread never polls its mpsc channel).
            interrupt_effort_plugin(&state, &id);

            // Transition to the terminal `cancelled` state so consumers and watch
            // loops observe it.
            dispatch::finalise_effort(
                &state,
                &id,
                EFFORT_CANCELLED,
                vec![TaskResult {
                    status: "cancelled".to_string(),
                    result: None,
                    error: None,
                }],
            );
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "accepted": true, "status": EFFORT_CANCELLED })),
            )
                .into_response()
        }
    }
}

// ── session handlers ──────────────────────────────────────────────────────────

async fn get_sessions(State(state): State<SidecarState>) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    let rows = match storage.query_nodes("Session") {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("query: {e}") })),
            )
                .into_response();
        }
    };

    let sessions: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| serde_json::from_str(&row.payload).ok())
        .collect();

    Json(serde_json::json!({ "sessions": sessions })).into_response()
}

// ── session create handler ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct NewSessionBody {
    name: Option<String>,
}

async fn post_session_new(
    State(state): State<SidecarState>,
    Json(body): Json<NewSessionBody>,
) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;

    let new_id = format!("urn:refarm:session:v1:{}", uuid::Uuid::new_v4().simple());
    let session_node = serde_json::json!({
        "@type": "Session",
        "@id": new_id,
        "name": body.name,
        "leaf_entry_id": serde_json::Value::Null,
        "parent_session_id": serde_json::Value::Null,
        "created_at_ns": now_ns,
    });

    match storage.store_node(&new_id, "Session", None, &session_node.to_string(), None) {
        Ok(()) => Json(serde_json::json!({ "session": session_node })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("store: {e}")).into_response(),
    }
}

// ── session fork handler ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ForkBody {
    entry_id: Option<String>,
    name: Option<String>,
}

async fn post_session_fork(
    State(state): State<SidecarState>,
    AxumPath(session_id): AxumPath<String>,
    Json(body): Json<ForkBody>,
) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    // Resolve original session — exact match then prefix.
    let session_raw = match storage.get_node(&session_id) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            let rows = storage.query_nodes("Session").unwrap_or_default();
            let matched: Vec<_> = rows.iter().filter(|r| r.id.contains(&session_id)).collect();
            match matched.len() {
                0 => return err(StatusCode::NOT_FOUND, "session not found").into_response(),
                1 => matched[0].payload.clone(),
                _ => {
                    return (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({
                            "error": format!("ambiguous prefix — {} sessions match", matched.len()),
                            "matches": matched.iter().map(|r| &r.id).collect::<Vec<_>>(),
                        })),
                    )
                        .into_response();
                }
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("get_node: {e}") })),
            )
                .into_response();
        }
    };

    let original: Value = match serde_json::from_str(&session_raw) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("parse: {e}") })),
            )
                .into_response();
        }
    };

    let original_id = original["@id"].as_str().unwrap_or(&session_id);

    // Branch point: caller-supplied entry_id or the current leaf of the original.
    let leaf = body
        .entry_id
        .as_deref()
        .or_else(|| original["leaf_entry_id"].as_str())
        .map(|s| s.to_owned());

    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;

    let new_id = format!("urn:refarm:session:v1:{}", uuid::Uuid::new_v4().simple());
    let fork_node = serde_json::json!({
        "@type": "Session",
        "@id": new_id,
        "name": body.name,
        "leaf_entry_id": leaf,
        "parent_session_id": original_id,
        "created_at_ns": now_ns,
    });

    match storage.store_node(&new_id, "Session", None, &fork_node.to_string(), None) {
        Ok(()) => Json(serde_json::json!({ "session": fork_node })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("store: {e}")).into_response(),
    }
}

// ── session history handler ───────────────────────────────────────────────────

async fn get_session_history(
    State(state): State<SidecarState>,
    AxumPath(session_id): AxumPath<String>,
) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    // Resolve session — exact match first, then prefix search among all sessions.
    let session_raw = match storage.get_node(&session_id) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            // Try prefix match over all Session nodes.
            let rows = storage.query_nodes("Session").unwrap_or_default();
            let matched: Vec<_> = rows.iter().filter(|r| r.id.contains(&session_id)).collect();
            match matched.len() {
                0 => return err(StatusCode::NOT_FOUND, "session not found").into_response(),
                1 => matched[0].payload.clone(),
                _ => {
                    return (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({
                            "error": format!("ambiguous prefix — {} sessions match", matched.len()),
                            "matches": matched.iter().map(|r| &r.id).collect::<Vec<_>>(),
                        })),
                    )
                        .into_response();
                }
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("get_node: {e}") })),
            )
                .into_response();
        }
    };

    let session: Value = match serde_json::from_str(&session_raw) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("parse session: {e}") })),
            )
                .into_response();
        }
    };

    // Walk the SessionEntry chain: leaf_entry_id → parent_entry_id.
    let mut entries: Vec<Value> = Vec::new();
    let mut current_id = session
        .get("leaf_entry_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned());

    const MAX_CHAIN: usize = 500;
    let mut steps = 0;
    while let Some(id) = current_id.take() {
        if steps >= MAX_CHAIN {
            break;
        }
        steps += 1;
        let raw = match storage.get_node(&id) {
            Ok(Some(r)) => r,
            _ => break,
        };
        let entry: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => break,
        };
        current_id = entry
            .get("parent_entry_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_owned());
        entries.push(serde_json::json!({
            "id":           entry.get("@id").and_then(|v| v.as_str()).unwrap_or(""),
            "kind":         entry.get("kind").and_then(|v| v.as_str()).unwrap_or(""),
            "content":      entry.get("content").and_then(|v| v.as_str()).unwrap_or(""),
            "timestamp_ns": entry.get("timestamp_ns").and_then(|v| v.as_u64()).unwrap_or(0),
        }));
    }

    // Reverse so entries are oldest-first.
    entries.reverse();

    Json(serde_json::json!({
        "session": session,
        "entries": entries,
        "total": entries.len(),
    }))
    .into_response()
}

// ── task handlers ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TaskQuery {
    status: Option<String>,
    session_id: Option<String>,
    #[serde(default = "default_task_limit")]
    limit: usize,
}

fn default_task_limit() -> usize {
    20
}

async fn get_tasks(
    State(state): State<SidecarState>,
    Query(params): Query<TaskQuery>,
) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    let rows = match storage.query_nodes("Task") {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("query: {e}") })),
            )
                .into_response();
        }
    };

    let mut tasks: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| serde_json::from_str::<Value>(&row.payload).ok())
        .filter(|t| {
            params
                .status
                .as_deref()
                .is_none_or(|s| t["status"].as_str() == Some(s))
        })
        .filter(|t| {
            params
                .session_id
                .as_deref()
                .is_none_or(|sid| t["context_id"].as_str() == Some(sid))
        })
        .collect();

    tasks.sort_by(|a, b| {
        b["created_at_ns"]
            .as_u64()
            .unwrap_or(0)
            .cmp(&a["created_at_ns"].as_u64().unwrap_or(0))
    });
    tasks.truncate(params.limit.min(100));

    Json(serde_json::json!({ "tasks": tasks, "total": tasks.len() })).into_response()
}

async fn get_task(
    State(state): State<SidecarState>,
    AxumPath(task_id): AxumPath<String>,
) -> impl IntoResponse {
    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("storage: {e}") })),
            )
                .into_response();
        }
    };

    let task_raw = match storage.get_node(&task_id) {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            let rows = storage.query_nodes("Task").unwrap_or_default();
            let matched: Vec<_> = rows.iter().filter(|r| r.id.contains(&task_id)).collect();
            match matched.len() {
                0 => return err(StatusCode::NOT_FOUND, "task not found").into_response(),
                1 => matched[0].payload.clone(),
                _ => {
                    return (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({
                            "error": format!("ambiguous prefix — {} tasks match", matched.len()),
                            "matches": matched.iter().map(|r| &r.id).collect::<Vec<_>>(),
                        })),
                    )
                        .into_response();
                }
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("get_node: {e}") })),
            )
                .into_response();
        }
    };

    let task: Value = match serde_json::from_str(&task_raw) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("parse: {e}") })),
            )
                .into_response();
        }
    };

    let canonical_id = task["@id"].as_str().unwrap_or(&task_id);
    let events: Vec<Value> = storage
        .query_nodes("TaskEvent")
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_str::<Value>(&r.payload).ok())
        .filter(|e| e["task_id"].as_str() == Some(canonical_id))
        .collect();

    Json(serde_json::json!({ "task": task, "events": events })).into_response()
}

// ── public API ────────────────────────────────────────────────────────────────

pub async fn start(state: SidecarState, host: String, port: u16) -> anyhow::Result<()> {
    // Reclaim terminal-and-old task-results/streams artifacts in the background,
    // bounding the daemon's on-disk growth. Self-terminates when state drops.
    // Reaper knobs resolved from env ONCE here at daemon start.
    reap::spawn_reaper(&state, reap::ReaperConfig::from_env());

    let router = Router::new()
        .route("/efforts", post(post_efforts).get(get_efforts))
        .route("/efforts/summary", get(get_efforts_summary))
        .route("/efforts/:id", get(get_effort))
        .route("/efforts/:id/logs", get(get_effort_logs))
        .route("/efforts/:id/retry", post(post_effort_retry))
        .route("/efforts/:id/cancel", post(post_effort_cancel))
        .route("/sessions", post(post_session_new).get(get_sessions))
        .route("/sessions/:id/fork", post(post_session_fork))
        .route("/sessions/:id/history", get(get_session_history))
        .route("/tasks", get(get_tasks))
        .route("/tasks/:id", get(get_task))
        .route("/plugins", get(get_plugins))
        .route("/plugins/reload", post(post_plugins_reload))
        .with_state(state);

    let bind_addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!(host = %host, port, "HTTP sidecar listening");
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
