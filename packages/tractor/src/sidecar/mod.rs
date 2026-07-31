//! HTTP sidecar — implements the ADR-060 effort protocol on top of TractorNative.
//!
//! Binds on the host its `surfaces.sidecar-http` declaration resolves to (`127.0.0.1:42001`
//! when nothing is declared) — and, when that host is NOT loopback, on `127.0.0.1` as well,
//! ungated: the node is not a remote device and does not authenticate to itself. See
//! `node_local` for the rule, why the credential layer is chosen per LISTENER rather than
//! per request, and the regression that made the invariant explicit.
//!
//! Exposes:
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
//!   GET    /connections                — every declared connection's registry state
//!   POST   /connections/:name/up       — ensure a declared connection (owner refarm/operator)
//!   POST   /connections/:name/down     — explicit operator stop
//!   POST   /prompts                    — publish a question and WAIT for it (long-poll)
//!   GET    /prompts                    — questions still waiting + the stated poll interval
//!   POST   /prompts/:id/answer         — settle one; first answer wins, attribution is the gate's
//!   GET    /stream/activity            — live SSE of process:* / agent:* activity
//!
//! Effort execution is async: each effort is dispatched in a separate tokio
//! task. Results and stream chunks are written to the filesystem so that
//! `refarm ask` can poll them without holding a connection open.

use std::{
    collections::HashMap,
    fs,
    // `axum::serve(..)` is `IntoFuture`, not `Future`: with more than one listener the
    // futures must be materialized and joined rather than `.await`ed in sequence.
    future::IntoFuture,
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
    /// Questions waiting for the operator, answerable from any surface that reaches this
    /// node (`pending_prompt`). In-memory and never persisted: a pending prompt's lifetime
    /// is its asker's open request, so nothing survives the asker — which is P1 of the
    /// pending-prompt design, obtained by construction rather than by a reaper.
    ///
    /// `pub(crate)` while every other field here is `pub`: the daemon binary builds this
    /// state through `new()` and never names the hub, and a hub reachable from outside the
    /// crate would be a second way to publish and settle prompts that bypasses the routes —
    /// which is exactly where the gate-resolved attribution lives.
    pub(crate) prompts: pending_prompt::PromptHub,
    /// The spawn ceiling for remote initiation (R4) — at most one started operation and one
    /// catalog read, ever. `pub(crate)` for the same reason `prompts` is: a ceiling reachable
    /// from outside the crate would be a second way to spawn that bypasses the routes, which
    /// is exactly where the bound lives.
    pub(crate) remote_initiations: remote_initiation::RemoteInitiations,
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
            prompts: pending_prompt::PromptHub::new(),
            remote_initiations: remote_initiation::RemoteInitiations::new(),
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
    format!("urn:sovereign:prompt-{}", effort_id.replace('-', ""))
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

/// The single append-only file the daemon writes `process:*` activity to, beside the
/// per-response stream files. A separate process (the CLI/TUI, or the web via the SSE
/// transport that serves the same file) TAILS it to render the operator's "working"
/// affordance — the sovereign, no-socket half of the activity bridge that mirrors how
/// `write_stream_chunk` streams response chunks.
pub(crate) const ACTIVITY_STREAM_NAME: &str = "activity";

/// Append one `ProcessActivity` JSON line to `streams_dir/activity.ndjson`. `payload` is
/// the already-shaped activity object ({activityRef, phase, label, kind, …}) from
/// `telemetry::process_activity`, so the file carries the SAME shape the telemetry bus and
/// the TS `ProcessActivity` do — one contract, three transports (file / SSE / WS).
pub(crate) fn write_activity_line(streams_dir: &Path, payload: &Value) -> std::io::Result<()> {
    let path = streams_dir.join(format!("{ACTIVITY_STREAM_NAME}.ndjson"));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    // Stamp the DURABLE line with the write time (ISO-8601) — the pure activity payload
    // stays time-free (the telemetry bus carries its own event time), but a file read
    // back later needs a timestamp, so `get_effort_logs` can order + report it. Added
    // only when absent, so a payload that already carries `ts` is respected.
    let line = match payload {
        Value::Object(map) if !map.contains_key("ts") => {
            let mut stamped = map.clone();
            stamped.insert("ts".to_string(), Value::String(now_iso8601()));
            Value::Object(stamped)
        }
        other => other.clone(),
    };
    writeln!(file, "{}", line)?;
    Ok(())
}

/// Current time as an ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SS.sssZ`) for durable activity lines —
/// via the shared `time`-backed `timefmt` module.
fn now_iso8601() -> String {
    crate::timefmt::now_iso_millis()
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

mod agent_activity;
pub(crate) use agent_activity::agent_event_to_activity;
mod activity_sse;
// `auth` is the sidecar's per-device credential policy. It was briefly `pub(crate)` so the
// WS bind guard could read "is a policy configured", and that WAS the wrong question at
// the time: the WS listener had no middleware, so a configured-but-unenforced policy is
// not permission (see `bind_guard`'s module doc) — the guard narrowed back to a private
// `auth`, refusing every non-loopback WS bind unconditionally.
//
// ADR-093 changes what is being asked. `daemon::ws_server` now REALLY authenticates the
// `Sec-WebSocket-Protocol` handshake against this SAME policy (`AuthPolicy::authenticate`,
// the same file, the same sha256 matching) — not a presence peek, an actual gate. That is
// the right question, so `auth` widens to `pub(crate)` for it. The bind guard's OWN "is a
// policy resolvable" bool still comes from `auth::auth_policy_configured()` — a cheap,
// non-authoritative peek (no file I/O, no log line) — never from resolving the full
// policy twice; see that function's doc comment for why the two stay distinct.
pub(crate) mod auth;
// `AuthPolicySource` (the refarm dir + "does the declaration name a device-token gate") and
// `ResolvedAuthPolicy` (what resolving it ONCE produced) are what must cross the
// library/binary crate boundary: `main.rs` knows both source facts at boot, resolves exactly
// once, and threads the ANSWER into both gates, exactly as it threads `SurfaceDeclaration`.
// `AuthPolicy` itself deliberately stays `pub(crate)`, and `ResolvedAuthPolicy`'s field is
// private — the SOURCE and the opaque ANSWER travel, the credentials never do.
pub use auth::{AuthPolicySource, ResolvedAuthPolicy};
pub(crate) mod bind_guard;
pub(crate) mod tailnet_resolve;
// The general "a node reaches itself" rule: a surface whose RESOLVED exposure is
// non-loopback ALSO listens on `127.0.0.1`, and the credential layer is chosen per
// LISTENER — never per request. `pub(crate)` because `daemon::ws_server` builds its own
// listen plan from the same rule; nothing about it is sidecar-specific.
pub(crate) mod node_local;
// The pending prompt: a question a blocked command is waiting on, listed and settled over
// this same gated surface so the operator can answer from wherever they are. `pub(crate)`
// so the hub type can sit on `SidecarState`; the routes are mounted in `sidecar_routes`
// alongside every other one, inside the same per-listener credential layer.
pub(crate) mod pending_prompt;
// Starting one of refarm's OWN wizards from a device (R4). Deliberately the dumbest module
// here: it knows no operation, holds no table, and hands an opaque id to one fixed
// entrypoint as one argv element. The decision lives in TypeScript, where R5 put it.
pub(crate) mod remote_initiation;
mod cors;
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
    State(state): State<SidecarState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    // The effort's log is its slice of the append-only activity stream
    // (`streams/activity.ndjson`) — the SAME lines the telemetry bus and a tailing
    // surface see, filtered to this effort's `activityRef` and mapped to the
    // `EffortLogEntry` contract (effort-contract-v1). The activity stream carries the
    // lifecycle phases the substrate already knows (started/finished); richer
    // per-attempt events populate as the producer emits them.
    let entries = read_effort_log_entries(&state.streams_dir, &id);
    (StatusCode::OK, Json(Value::Array(entries)))
}

/// Read `streams/activity.ndjson`, keep the lines whose `activityRef == effort_id`, and
/// map each to an `EffortLogEntry` JSON value. Returns `[]` when the file is absent or no
/// line matches — the endpoint never fails on a missing/unknown effort (a bad id yields
/// `[]`, matching the file-based `logs` reader on the TS side). PURE over the file.
fn read_effort_log_entries(streams_dir: &Path, effort_id: &str) -> Vec<Value> {
    let path = streams_dir.join(format!("{ACTIVITY_STREAM_NAME}.ndjson"));
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|v| v.get("activityRef").and_then(Value::as_str) == Some(effort_id))
        .filter_map(|v| effort_log_entry_from_activity(&v, effort_id))
        .collect()
}

/// Map one activity line (`{activityRef, phase, label, kind, ok?, ts?}`) to an
/// `EffortLogEntry`. Returns None for phases with no log counterpart. PURE — unit-tested.
fn effort_log_entry_from_activity(activity: &Value, effort_id: &str) -> Option<Value> {
    let phase = activity.get("phase").and_then(Value::as_str)?;
    let label = activity.get("label").and_then(Value::as_str).unwrap_or("");
    let ok = activity.get("ok").and_then(Value::as_bool);
    let (event, level) = match phase {
        "started" => ("processing_started", "info"),
        "finished" => (
            "processing_finished",
            if ok == Some(false) { "error" } else { "info" },
        ),
        _ => return None, // progress/other phases have no EffortLogEntry event today
    };
    // The write side stamps `ts` (ISO-8601) at append; older lines without it fall back
    // to an empty string rather than a fabricated time.
    let timestamp = activity.get("ts").and_then(Value::as_str).unwrap_or("");
    Some(serde_json::json!({
        "effortId": effort_id,
        "timestamp": timestamp,
        "level": level,
        "event": event,
        "message": label,
    }))
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

    let new_id = format!("urn:sovereign:session:v1:{}", uuid::Uuid::new_v4().simple());
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

    let new_id = format!("urn:sovereign:session:v1:{}", uuid::Uuid::new_v4().simple());
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

// ── connection handlers ──────────────────────────────────────────────────────
//
// The operator's own door onto the shared connection engine (the design at
// `docs/superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md`).
// `GET /connections` lists every DECLARED connection (a name declared but never
// established reports `down`, never omitted); `POST .../up` ensures it under the fixed
// owner `CONNECTION_OWNER_OPERATOR` ("refarm/operator") — a value no plugin id can ever
// be, since it contains a `/` (see that constant's own doc) — so `release_owner` (run
// on plugin unload) can never collect it as a side effect of plugin lifecycle;
// `POST .../down` is the explicit
// operator stop — sovereign even with claims outstanding, but the response REPORTS how
// many were active rather than hiding the count (D12, "the operator is shown reality").
//
// All three sit BEHIND the same opt-in auth gate as every other route here — they are
// registered on the SAME `Router` in `start()` below, inside the `auth::auth_middleware`
// layer applied to the whole router, not on some side door around it.

fn connection_operator_state_json(state: &crate::host::ConnectionOperatorState) -> Value {
    serde_json::json!({
        "name": state.name,
        "status": state.status,
        "sinceNs": state.since_ns,
        "claims": state.claims,
        "claim": state.claim,
    })
}

/// `None` when the sidecar was built without a live host wired (`with_reload`) — a test
/// sidecar, or a boot ordering issue. Reported honestly as 503, matching the other
/// `state.reload`-gated routes (`post_plugins_reload`, `post_plugins_load_by_hash`)
/// rather than pretending the call happened.
fn require_live_host(state: &SidecarState) -> Result<&std::sync::Arc<crate::TractorNative>, axum::response::Response> {
    state.reload.as_ref().ok_or_else(|| {
        err(
            StatusCode::SERVICE_UNAVAILABLE,
            "no live host wired; connections are unavailable",
        )
        .into_response()
    })
}

async fn get_connections(State(state): State<SidecarState>) -> impl IntoResponse {
    let host = match require_live_host(&state) {
        Ok(host) => host,
        Err(response) => return response,
    };
    match host.plugins.list_declared_connections(&host.sync) {
        Ok(list) => {
            let connections: Vec<Value> = list.iter().map(connection_operator_state_json).collect();
            Json(serde_json::json!({ "connections": connections })).into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn post_connection_up(
    State(state): State<SidecarState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    let host = match require_live_host(&state) {
        Ok(host) => host,
        Err(response) => return response,
    };
    match host.plugins.ensure_connection_as_operator(&host.sync, &name).await {
        Ok(conn_state) => {
            (StatusCode::OK, Json(connection_operator_state_json(&conn_state))).into_response()
        }
        Err(crate::host::ConnectionOperatorError::Undeclared(message)) => {
            err(StatusCode::NOT_FOUND, &message).into_response()
        }
        Err(crate::host::ConnectionOperatorError::Failed(message)) => {
            err(StatusCode::INTERNAL_SERVER_ERROR, &message).into_response()
        }
    }
}

async fn post_connection_down(
    State(state): State<SidecarState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    let host = match require_live_host(&state) {
        Ok(host) => host,
        Err(response) => return response,
    };
    match host.plugins.stop_connection_as_operator(&name) {
        Ok((conn_state, claims_active)) => {
            let mut body = connection_operator_state_json(&conn_state);
            body["claimsActive"] = serde_json::json!(claims_active);
            (StatusCode::OK, Json(body)).into_response()
        }
        Err(crate::host::ConnectionOperatorError::Undeclared(message)) => {
            err(StatusCode::NOT_FOUND, &message).into_response()
        }
        Err(crate::host::ConnectionOperatorError::Failed(message)) => {
            err(StatusCode::INTERNAL_SERVER_ERROR, &message).into_response()
        }
    }
}

// ── public API ────────────────────────────────────────────────────────────────

/// The sidecar's routes — the SHARED half of every listener, identical on all of them. A
/// surface's routes are a property of the surface, not of which socket a request arrived
/// on: the node-local listener serves exactly the same API as the declared one, and the
/// only difference between the two is the credential layer `listener_router` adds (or does
/// not add) on top. PURE: builds a value, binds nothing.
fn sidecar_routes(state: SidecarState) -> Router {
    Router::new()
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
        // The two routes whose required SCOPE is declared — `auth::route_requirement` names
        // these same constants, so the path the router serves and the path the gate judges
        // cannot drift apart by a rename. `GET` here is reachable by a `prompt:answer` scoped
        // credential; `POST /prompts` (publishing a question) is not, and no other route is.
        .route(
            auth::ROUTE_PROMPTS,
            post(pending_prompt::post_prompts).get(pending_prompt::get_prompts),
        )
        .route(
            auth::ROUTE_PROMPT_ANSWER,
            post(pending_prompt::post_prompt_answer),
        )
        // Remote initiation (R4). NOT named in `auth::route_requirement`, and that omission
        // is the decision: a route declaring no scope admits device credentials only. A
        // browser's `prompt:answer` credential answers questions; it never starts work.
        .route(
            remote_initiation::ROUTE_OPERATIONS,
            post(remote_initiation::post_operations).get(remote_initiation::get_operations),
        )
        .route("/connections", get(get_connections))
        .route("/connections/:name/up", post(post_connection_up))
        .route("/connections/:name/down", post(post_connection_down))
        .route("/stream/activity", get(activity_sse::get_stream_activity))
        .with_state(state)
}

/// The router ONE listener serves: the shared routes, plus the credential layer that
/// listener's ROLE earns, plus CORS. THE place the per-listener authentication decision is
/// realized, and the reason it is a named function rather than an inline block in `start`:
/// the credential layer is attached (or not) here, once per socket, from `role` — never from
/// anything a request carries.
///
/// - `node_local::gate_for(role, gate)` yields `None` for a [`node_local::ListenRole::NodeLocal`]
///   listener whatever `gate` is, so that listener is CONSTRUCTED with no auth middleware at
///   all. There is no code inside it that could decide to skip authentication, because there
///   is no authentication inside it to skip.
/// - a [`node_local::ListenRole::Declared`] listener gets exactly the layer it always got:
///   `Some(gate)` ⇒ every request must carry a valid bearer credential (`deny_all` behind the
///   gate ⇒ every request `401`, the strictest enforcement of a declared gate); `None` ⇒ no
///   layer, byte-identical to a sidecar with no gate declared.
///
/// The auth layer goes on INNER of CORS, unchanged, so a browser's OPTIONS preflight — which
/// carries no credential — is answered by CORS before the gate sees it. What the layer
/// captures is the LIVE gate (an `Arc`), not a copy of the credentials: a copy would freeze
/// the policy at boot and put enrolment — and revocation — behind a full runtime restart.
/// See `auth::AuthGate`.
///
/// PURE: builds a value, binds nothing.
fn listener_router(
    routes: Router,
    role: node_local::ListenRole,
    gate: Option<auth::AuthGate>,
    cors_policy: Option<cors::CorsPolicy>,
) -> Router {
    let routes = match node_local::gate_for(role, gate) {
        Some(gate) => routes.layer(axum::middleware::from_fn(move |req, next| {
            auth::auth_middleware(gate.clone(), req, next)
        })),
        None => routes,
    };
    match cors_policy {
        Some(policy) => routes.layer(axum::middleware::from_fn(move |req, next| {
            cors::cors_middleware(policy.clone(), req, next)
        })),
        None => routes,
    }
}

pub async fn start(
    state: SidecarState,
    // `None` means `--http-host` was not passed — under S1/S5 an absent flag is not a
    // value at all (see main.rs's `DaemonArgs::http_host` doc comment), so the
    // `surfaces.sidecar-http` DECLARATION decides the actual bind host below.
    // `Some(v)` means the operator IS narrowing (or asserting) — `v` is validated
    // against the declared ceiling, never widened past it.
    host: Option<String>,
    port: u16,
    // The resolved `surfaces.sidecar-http` declaration (S1/S3/S5), read ONCE at daemon
    // boot (`crate::host::surfaces_from_config`) and threaded in by the caller — `start`
    // never reads `.refarm/config.json` itself, matching `auth_policy` below (resolved
    // once, reused). `None` means undeclared, NOT "declaration permits anything" (S1).
    declared_surface: Option<crate::host::SurfaceDeclaration>,
    // The auth policy ALREADY RESOLVED — once, at daemon start, by main.rs — and threaded
    // in, exactly like `declared_surface`. This function does not receive an
    // `AuthPolicySource` and therefore CANNOT resolve one: it used to, and so did
    // `daemon::WsServer::start`, which is why a declared-but-unenrolled gate printed its
    // ABSENT warning twice per boot and why two gates could in principle read two different
    // policies. See `auth::ResolvedAuthPolicy`.
    auth_policy: auth::ResolvedAuthPolicy,
) -> anyhow::Result<()> {
    // Resolve `expose: "tailnet"` into a concrete `host:<ip>` BEFORE the guard ever runs
    // — see `tailnet_resolve`'s module doc (open question 1 of the declared-surfaces
    // design). A no-op (no `tailscale` spawn) unless `declared_surface` actually declares
    // `tailnet` and the flag isn't already narrowing to loopback. `bind_guard` below never
    // sees an unresolved `Tailnet` as a result.
    let declared_surface = tailnet_resolve::resolve_declared_expose_for_bind(
        crate::host::SURFACE_SIDECAR_HTTP,
        "the sidecar",
        host.as_deref(),
        declared_surface.as_ref(),
    )
    .map_err(|reason| anyhow::anyhow!(reason))?;

    // Resolve the ACTUAL bind host from the flag + declaration, and validate it in the
    // same call — see `bind_guard::resolve_sidecar_bind_host` for the full S1/S3/S5
    // reasoning. This is the promoted question: does the declaration PERMIT this bind
    // (or DECIDE it, when the flag was absent), and can this surface ENFORCE what the
    // declaration claims? Checked before anything else in `start` so a disallowed
    // non-loopback bind never gets as far as building a router or touching a socket.
    let host = bind_guard::resolve_sidecar_bind_host(
        host.as_deref(),
        auth_policy.is_gated(),
        declared_surface.as_ref(),
    )
    .map_err(|reason| anyhow::anyhow!(reason))?;

    // Reclaim terminal-and-old task-results/streams artifacts in the background,
    // bounding the daemon's on-disk growth. Self-terminates when state drops.
    // Reaper knobs resolved from env ONCE here at daemon start.
    reap::spawn_reaper(&state, reap::ReaperConfig::from_env());

    let router = sidecar_routes(state);

    // ADR-088: layer OPT-IN CORS only when REFARM_SIDECAR_CORS_ORIGINS is set. The
    // default (unset) leaves the router untouched — no CORS surface — because the
    // supported browser path is the same-origin proxy on `refarm serve`. Read ONCE here,
    // then applied identically to every listener below: the CORS surface is a property of
    // the sidecar, not of which socket a request arrived on.
    let cors_policy = cors::cors_config_from_env();
    if let Some(policy) = cors_policy.as_ref() {
        tracing::info!(?policy, "sidecar CORS enabled (opt-in)");
    }

    // The node reaches itself: a resolved host that is NOT loopback opens a second,
    // ADDITIVE `127.0.0.1` socket alongside it — see `node_local`'s module doc for the
    // regression this closes (`expose: "tailnet"` bound ONLY the tailnet address, so every
    // local client, `refarm ask` first among them, reported a live runtime as down). A
    // loopback-resolved host yields exactly one target, unchanged.
    let plan = node_local::listen_plan(&host);

    // Bind EVERY target before serving ANY of them, and treat a failure on either as fatal
    // to the whole surface. Half-bound is the exact state this rule exists to eliminate:
    // outward-only breaks the operator's own CLI while the daemon logs success, and
    // local-only makes a declared surface silently absent from the address it advertises.
    // Binding first also means a refusal leaves nothing serving — the already-bound
    // listeners are dropped by this `?`.
    let mut bound = Vec::with_capacity(plan.len());
    for target in &plan {
        let addr = format!("{}:{}", target.host, port);
        let listener = TcpListener::bind(&addr).await.map_err(|e| {
            anyhow::anyhow!(target.role.describe_bind_failure("the sidecar", &addr, &e.to_string()))
        })?;
        bound.push((listener, target.role));
    }

    // ONE line, naming every address and its role. A line naming a single host was accurate
    // only while there was a single socket; with two, it hides exactly the fact an operator
    // needs (which addresses answer, and which of them is gated).
    tracing::info!(
        addresses = %node_local::describe_listen_plan(&plan, port),
        port,
        "HTTP sidecar listening"
    );

    // THE authentication decision, made once per LISTENER and never per request, inside
    // `listener_router`: the node-local socket is CONSTRUCTED without the credential layer,
    // the declared socket with it. `auth_policy` is the value main.rs resolved at daemon
    // start — the same value the bind guard above consulted, and the same value the WS
    // handshake gate enforces.
    let mut serving = Vec::with_capacity(bound.len());
    for (listener, role) in bound {
        let router =
            listener_router(router.clone(), role, auth_policy.gate(), cors_policy.clone());
        serving.push(axum::serve(listener, router).into_future());
    }

    // Serve every socket concurrently; the first failure ends the surface. There is no
    // "keep the other listener alive" path for the same reason there is no half-bound start.
    futures_util::future::try_join_all(serving).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
