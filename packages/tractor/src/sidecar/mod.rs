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
//!   GET    /nodes?type=:type           — list graph nodes by type
//!   GET    /nodes/:id                  — graph node by id
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
        EFFORT_DONE | EFFORT_DELIVERED | "partial" | EFFORT_FAILED | "timed-out" | EFFORT_CANCELLED
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
type EffortInputStore = Arc<RwLock<HashMap<String, Effort>>>;

// ── sidecar state ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SidecarState {
    pub efforts: EffortStore,
    /// The original submitted Effort (tasks/args), retained so retry can
    /// re-dispatch it. The `efforts` store above keeps only EffortResult, which
    /// has no tasks. In-process only: this map starts empty on boot and is not
    /// persisted — retry re-runs an effort submitted during THIS sidecar
    /// lifetime; after a restart the input is gone and retry reports so.
    /// Reaped alongside `efforts` (same effort_id) so it can't grow unbounded.
    pub efforts_input: EffortInputStore,
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
    /// ID of the loaded plugin with `"integration:respond"` capability, if any.
    /// Populated by TractorNative.register_for_events; used for effort routing.
    pub default_responder_id: Arc<RwLock<Option<String>>>,
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
    /// The live host, for `/plugins/reload` to invoke `reload_plugin`. Injected by
    /// the daemon via `with_reload`; None in tests that construct the sidecar
    /// without a running host (the reload endpoint then reports it's unavailable).
    pub reload: Option<Arc<crate::TractorNative>>,
    /// The shared plugin capability registry, for the synchronous `respond` route to
    /// consult `serves_sync` (ADR-084's negotiated-sync guard) before dispatching a
    /// respond. Injected by the daemon via `with_registry`; None in tests without one.
    pub plugin_registry: Option<crate::host::PluginRegistry>,
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
        default_responder_id: Arc<RwLock<Option<String>>>,
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
            default_responder_id,
            event_router,
            telemetry,
            streams_dir,
            results_dir,
            namespace,
            respond_watch: RespondWatchConfig::from_env(),
            reload: None,
            plugin_registry: None,
        })
    }

    /// Inject the live host so `/plugins/reload` can actually reload. The daemon
    /// calls this after boot; tests that don't need reload omit it (the endpoint
    /// then reports reload is unavailable rather than pretending it worked).
    pub fn with_reload(mut self, host: Arc<crate::TractorNative>) -> Self {
        self.reload = Some(host);
        self
    }

    /// Inject the shared plugin capability registry so the synchronous `respond` route
    /// can enforce the ADR-084 sync guard (`serves_sync`). The daemon calls this after
    /// boot; tests omit it when they don't exercise the respond route.
    pub fn with_registry(mut self, registry: crate::host::PluginRegistry) -> Self {
        self.plugin_registry = Some(registry);
        self
    }

    /// Construct a sidecar state with empty default host-shared maps — the ONE
    /// place tests build a `SidecarState`, so a new field is added here once
    /// instead of in every test helper. Byte-neutral with the manual construction
    /// it replaces: the same empty channels/cancel maps, a default router and a
    /// 100-slot telemetry bus. No reload host (tests opt in via `with_reload`).
    #[cfg(test)]
    pub(crate) fn for_test(base_dir: &Path, namespace: &str) -> std::io::Result<Self> {
        Self::new(
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(HashMap::new())),
            Arc::new(RwLock::new(None)),
            crate::EventRouter::default(),
            crate::TelemetryBus::new(100),
            base_dir,
            namespace.to_string(),
        )
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
    format!("urn:refarm:prompt-{}", effort_id.replace('-', ""))
}

fn stream_ref_for_prompt(prompt_ref: &str) -> String {
    format!("urn:tractor:stream:response:{prompt_ref}")
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
    let default_responder = state
        .default_responder_id
        .read()
        .expect("default_responder_id poisoned")
        .clone();

    Json(serde_json::json!({
        "installed": loaded,
        "loaded": loaded,
        "local": [],
        "known": loaded,
        "defaultResponder": default_responder,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReloadRequest {
    pub plugin_ids: Option<Vec<String>>,
}

/// Load a plugin by content hash from a content-store (E3) — the runtime seam for when
/// a grant + pointer arrive over CRDT after boot. `assetsDir`/`hash` locate the bytes;
/// `manifest` is the plugin.json (pointer) to pair with them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLoadByHashRequest {
    pub assets_dir: String,
    pub hash: String,
    pub manifest: String,
}

/// Hot-reload the requested plugins (all loaded ones if none specified).
///
/// When the daemon injected a reload host (`with_reload`), each requested plugin
/// is reloaded for real via `TractorNative::reload_plugin` — unregister the
/// running instance(s), re-read its (possibly rebuilt) bytes (the content-
/// addressed cache recompiles only if they changed), and re-register. A plugin
/// that isn't loaded, or whose source path wasn't retained, lands in `skipped`.
///
/// Without a reload host (a sidecar constructed in a test without the live host),
/// the endpoint degrades to an HONEST readiness probe: it reports which requested
/// plugins are currently loaded and `reloaded: false`, so a client can never
/// mistake "the host wasn't wired" for an actual code swap.
pub async fn post_plugins_reload(
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

    let Some(host) = state.reload.as_ref() else {
        // No live host wired — degrade to a readiness probe (see the doc above).
        let mut already_loaded = Vec::new();
        let mut skipped = Vec::new();
        for plugin_id in requested {
            if loaded.contains(&plugin_id) {
                already_loaded.push(plugin_id);
            } else {
                skipped.push(plugin_id);
            }
        }
        return Json(serde_json::json!({
            "probeId": uuid::Uuid::new_v4().to_string(),
            "alreadyLoaded": already_loaded,
            "skipped": skipped,
            "reloaded": false,
        }))
        .into_response();
    };

    // Real hot-reload: reload_plugin returns Ok(true) when it swapped code,
    // Ok(false) when the plugin wasn't loaded / had no retained path.
    let mut reloaded = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();
    for plugin_id in requested {
        match host.reload_plugin(&plugin_id).await {
            Ok(true) => reloaded.push(plugin_id),
            Ok(false) => skipped.push(plugin_id),
            Err(e) => {
                errors.push(serde_json::json!({ "pluginId": plugin_id, "error": e.to_string() }))
            }
        }
    }

    Json(serde_json::json!({
        "reloadId": uuid::Uuid::new_v4().to_string(),
        "reloaded": reloaded,
        "skipped": skipped,
        "errors": errors,
    }))
    .into_response()
}

/// POST /plugins/load-by-hash — load a plugin from the content-store by hash (E3).
/// The runtime counterpart to the `--plugin-by-hash` boot arg: for a grant + pointer
/// that arrive over CRDT after boot, load the plugin without a daemon restart. The bytes
/// are verified (hash gate + E1 integrity + manifest/runtime alignment) before running.
/// register only (no pool-staging): load_plugin_by_hash materializes into a dropped
/// tempdir, so there is no retained source path for staging/reload of a CAS-loaded plugin.
pub async fn post_plugins_load_by_hash(
    State(state): State<SidecarState>,
    Json(request): Json<PluginLoadByHashRequest>,
) -> impl IntoResponse {
    let Some(host) = state.reload.as_ref() else {
        return Json(serde_json::json!({ "loaded": false, "reason": "no live host wired" }))
            .into_response();
    };
    match host
        .load_plugin_by_hash(
            std::path::Path::new(&request.assets_dir),
            &request.hash,
            &request.manifest,
        )
        .await
    {
        Ok(handle) => {
            let plugin_id = handle.id.clone();
            host.register_for_events(handle);
            Json(serde_json::json!({ "loaded": true, "pluginId": plugin_id })).into_response()
        }
        Err(e) => {
            Json(serde_json::json!({ "loaded": false, "error": e.to_string() })).into_response()
        }
    }
}

/// The body of a synchronous respond request: the verb to invoke and its JSON payload.
#[derive(serde::Deserialize)]
pub struct PluginRespondRequest {
    /// The `<key>:<verb>` the caller wants to invoke synchronously.
    pub verb: String,
    /// The payload the guest's `respond` receives (opaque JSON string).
    #[serde(default)]
    pub payload: Option<String>,
}

/// POST /plugins/:id/respond — ADR-084's synchronous respond surface. This is the ONE
/// in-band request→response path to a loaded plugin: the caller names a `<key>:<verb>`
/// the plugin declared in `syncVerbs`, and the host calls the guest's `respond` and
/// returns its string reply in the response body — no effort id, no polling.
///
/// The negotiated-sync GUARD is enforced here: a verb the plugin did not declare
/// synchronous is refused with a clean `not-supported`, never routed to a hung call.
/// A missing registry (test without one) or an unknown plugin/channel is reported, not
/// silently dropped. The reply is bounded by the respond-watch timeout so a wedged
/// guest returns an error rather than holding the connection open.
pub async fn post_plugin_respond(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<PluginRespondRequest>,
) -> impl IntoResponse {
    // Guard: the plugin must have declared this verb synchronous (serves_sync).
    match state.plugin_registry.as_ref() {
        None => {
            return Json(serde_json::json!({
                "ok": false, "error": "sync-unavailable",
                "message": "no plugin registry wired; sync respond is unavailable",
            }))
            .into_response();
        }
        Some(registry) if !registry.serves_sync(&id, &req.verb) => {
            return Json(serde_json::json!({
                "ok": false, "error": "not-supported",
                "message": format!(
                    "plugin \"{id}\" does not serve \"{}\" synchronously (declare it in capabilities.syncVerbs)",
                    req.verb
                ),
            }))
            .into_response();
        }
        Some(_) => {}
    }

    // Reach the plugin's runner via its mpsc channel, carrying a oneshot for the reply.
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    let sent = {
        let channels = state.plugin_channels.read().expect("channels poisoned");
        channels
            .get(&id)
            .map(|tx| tx.send(crate::EventEnvelope::respond_request(req.payload, reply_tx)))
    };
    match sent {
        None => {
            return Json(serde_json::json!({
                "ok": false, "error": "plugin-not-loaded",
                "message": format!("no loaded plugin with id \"{id}\""),
            }))
            .into_response();
        }
        Some(Err(_)) => {
            return Json(serde_json::json!({
                "ok": false, "error": "plugin-unreachable",
                "message": format!("plugin \"{id}\" runner channel is closed"),
            }))
            .into_response();
        }
        Some(Ok(())) => {}
    }

    // Await the guest's reply, bounded so a wedged guest can't hold the connection.
    let timeout = std::time::Duration::from_millis(state.respond_watch.timeout_ms);
    match tokio::time::timeout(timeout, reply_rx).await {
        Ok(Ok(Ok(reply))) => {
            Json(serde_json::json!({ "ok": true, "verb": req.verb, "reply": reply }))
                .into_response()
        }
        Ok(Ok(Err(message))) => Json(serde_json::json!({
            "ok": false, "error": "respond-failed", "message": message,
        }))
        .into_response(),
        Ok(Err(_)) => Json(serde_json::json!({
            "ok": false, "error": "respond-dropped",
            "message": "the plugin runner dropped the reply channel",
        }))
        .into_response(),
        Err(_) => Json(serde_json::json!({
            "ok": false, "error": "respond-timeout",
            "message": "the plugin did not respond within the deadline",
        }))
        .into_response(),
    }
}

mod dispatch;
pub(crate) use dispatch::*;
// The agent terminal-result contract is part of the crate's PUBLIC surface: the
// `tractor` binary's CLI readers query for it too, and they are a separate crate.
pub use dispatch::{
    AGENT_RESPONSE_CORRELATION_KEY, AGENT_RESPONSE_NODE_TYPE, AGENT_RESPONSE_TERMINAL_FIELD,
};
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
    // STUB: per-effort log entries are not persisted yet, so this always returns
    // an empty array and does NOT validate the id (a bad id gets `[]`, not 404) —
    // a client can't yet distinguish "no logs" from "unknown effort". Kept as a
    // documented placeholder until effort logs are stored.
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
        .default_responder_id
        .read()
        .expect("default_responder_id poisoned")
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

// ── provider liveness handler ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ProviderLivenessQuery {
    provider: Option<String>,
}

/// How long to wait for a provider to answer a reachability probe. A liveness
/// check should be quick; a slow endpoint is treated as unreachable.
const PROVIDER_LIVENESS_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(2000);

// ── provider reachability reason vocabulary ───────────────────────────────────
//
// Mirrors `ProviderProbeReason` in apps/refarm's model-provider-doctor.ts. The
// TS consumer deserializes these strings verbatim, so these constants are the
// single Rust source of truth — do not write reason literals inline (same rule as
// EFFORT_* above).
//
//   reachable    — the endpoint answered (any HTTP status that is not a transport
//                  error proves the route is up)
//   auth-failed  — endpoint up but rejected the unauthenticated GET (401/403)
//   unreachable  — transport error (DNS/connect/timeout): the route did not answer
//
// `no-endpoint-source` (the fourth ProviderProbeReason member) is resolved
// TS-side and never emitted here — this handler only runs once a base URL exists.
const PROBE_REACHABLE: &str = "reachable";
const PROBE_AUTH_FAILED: &str = "auth-failed";
const PROBE_UNREACHABLE: &str = "unreachable";

/// Read-only provider reachability probe. TS calls this for providers whose base
/// URL only the Rust host knows (the canonical provider→URL map lives here, not
/// in TS). UNAUTHENTICATED by design ("só rotas não segredos"): it checks the
/// route, never sends a key. A 401/403 still proves the endpoint is up, so it maps
/// to `auth-failed` rather than `unreachable`. The `reason` vocabulary matches the
/// TS providerProbe (reachable | unreachable | auth-failed | no-endpoint-source).
async fn get_provider_liveness(Query(q): Query<ProviderLivenessQuery>) -> impl IntoResponse {
    let Some(provider) = q
        .provider
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
    else {
        return err(
            StatusCode::BAD_REQUEST,
            "provider query parameter is required",
        )
        .into_response();
    };

    let base_url = crate::host::provider_base_url_for_liveness(&provider);

    // The probe is a blocking ureq GET; run it off the async runtime so the
    // sidecar stays responsive. ureq is already the host's HTTP client (the model
    // completion path uses it), so no new dependency weight — reqwest stays
    // test-only per the §7 RAM budget.
    let probe_url = base_url.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        match ureq::get(&probe_url)
            .timeout(PROVIDER_LIVENESS_TIMEOUT)
            .call()
        {
            // Any 2xx/3xx/other non-error status: the endpoint answered → up.
            Ok(resp) => (true, Some(resp.status()), PROBE_REACHABLE),
            // 401/403: endpoint is up, it just rejected the unauthenticated GET.
            Err(ureq::Error::Status(401 | 403, resp)) => {
                (true, Some(resp.status()), PROBE_AUTH_FAILED)
            }
            // Any other HTTP status still proves the endpoint answered → reachable.
            Err(ureq::Error::Status(code, _)) => (true, Some(code), PROBE_REACHABLE),
            // Transport error (DNS, connect, timeout) → the route did not answer.
            Err(ureq::Error::Transport(_)) => (false, None, PROBE_UNREACHABLE),
        }
    })
    .await;

    let (reachable, status, reason) = match outcome {
        Ok(o) => o,
        // The blocking task itself failed (panic/cancel) — report unreachable
        // rather than inventing a verdict.
        Err(_) => (false, None, PROBE_UNREACHABLE),
    };

    Json(serde_json::json!({
        "provider": provider,
        "baseUrl": base_url,
        "reachable": reachable,
        "status": status,
        "reason": reason,
    }))
    .into_response()
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

// ── generic node handlers ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct NodesQuery {
    #[serde(rename = "type")]
    type_: Option<String>,
    #[serde(default = "default_nodes_limit")]
    limit: usize,
}

fn default_nodes_limit() -> usize {
    20
}

fn node_value_from_row(row: crate::storage::NodeRow) -> Result<Value, String> {
    let mut node: Value =
        serde_json::from_str(&row.payload).map_err(|e| format!("parse node: {e}"))?;
    let Value::Object(ref mut object) = node else {
        return Err("parse node: payload is not an object".to_string());
    };
    object
        .entry("@id".to_string())
        .or_insert_with(|| Value::String(row.id));
    object
        .entry("@type".to_string())
        .or_insert_with(|| Value::String(row.type_));
    Ok(node)
}

async fn get_nodes(
    State(state): State<SidecarState>,
    Query(params): Query<NodesQuery>,
) -> impl IntoResponse {
    let Some(type_) = params
        .type_
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return err(StatusCode::BAD_REQUEST, "missing type").into_response();
    };

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

    let nodes: Vec<Value> = match storage.query_nodes(type_) {
        Ok(rows) => {
            let mut nodes = Vec::new();
            for row in rows.into_iter().take(params.limit.min(100)) {
                let node = match node_value_from_row(row) {
                    Ok(node) => node,
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({ "error": e })),
                        )
                            .into_response();
                    }
                };
                nodes.push(node);
            }
            nodes
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("query: {e}") })),
            )
                .into_response();
        }
    };

    Json(serde_json::json!({ "nodes": nodes, "total": nodes.len() })).into_response()
}

async fn get_node_by_id(
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
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

    match storage.get_node_row(&id) {
        Ok(Some(row)) => match node_value_from_row(row) {
            Ok(node) => Json(serde_json::json!({ "node": node })).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response(),
        },
        Ok(None) => err(StatusCode::NOT_FOUND, "node not found").into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("get_node_row: {e}") })),
        )
            .into_response(),
    }
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
        .route("/nodes", get(get_nodes))
        .route("/nodes/:id", get(get_node_by_id))
        .route("/tasks", get(get_tasks))
        .route("/tasks/:id", get(get_task))
        .route("/plugins", get(get_plugins))
        .route("/plugins/reload", post(post_plugins_reload))
        .route("/plugins/load-by-hash", post(post_plugins_load_by_hash))
        .route("/plugins/:id/respond", post(post_plugin_respond))
        .route("/providers/liveness", get(get_provider_liveness))
        .with_state(state);

    let bind_addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!(host = %host, port, "HTTP sidecar listening");
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
