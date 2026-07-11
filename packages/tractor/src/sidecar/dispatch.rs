//! The sidecar's async effort execution engine: SidecarState-threaded
//! dispatch of respond (agent prompt) and non-respond (router event) efforts,
//! plus finalisation and time helpers. Extracted verbatim from mod.rs; the
//! model, persistence, and stream helpers stay in the parent and are imported.

use serde_json::Value;

use super::{
    persist_effort_result, prompt_ref_from_effort, record_effort_result, stream_ref_for_prompt,
    write_stream_chunk, Effort, EffortResult, EffortTask, SidecarState, TaskResult,
};

/// The agent's TERMINAL-RESULT contract, declared ONCE. A responding plugin stores
/// a node of `AGENT_RESPONSE_NODE_TYPE` carrying its `content`, keyed by
/// `AGENT_RESPONSE_CORRELATION_KEY` (the prompt it answers) and marked terminal by
/// `AGENT_RESPONSE_TERMINAL_FIELD`; the host watches for exactly that shape to
/// finalise the respond effort. These name the contract the host applies as the
/// DEFAULT for every responder today — the seam a per-plugin declared contract would
/// later populate — instead of the host re-stating `"Response"` as a bare literal
/// across the store, watcher, reader, and reaper.
pub const AGENT_RESPONSE_NODE_TYPE: &str = "Response";
pub const AGENT_RESPONSE_CORRELATION_KEY: &str = "prompt_ref";
pub const AGENT_RESPONSE_TERMINAL_FIELD: &str = "is_final";

#[derive(Debug)]
pub(crate) struct TaskArgs {
    pub(crate) prompt: String,
    pub(crate) system: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) history_turns: Option<u64>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
}

/// Describes the terminal RESULT node a dispatch awaits, so the watcher is
/// generic ("await a terminal correlated result") rather than agent-specific.
/// The LLM agent uses the default (an `AgentResponse` keyed by `prompt_ref`,
/// terminal when `is_final` is true), but ANY plugin that writes a node of its
/// own `node_type` carrying the same shape can be awaited the same way — the same
/// move EventRouter made for events. Nothing here is LLM-intrinsic; the write
/// path (store_node bridge, loro→sqlite projection, query_nodes) is already
/// type-agnostic.
#[derive(Debug, Clone)]
pub(crate) struct TerminalResultSpec {
    /// JSON-LD `@type` of the result node to query for.
    pub(crate) node_type: String,
    /// Field name carrying the correlation id (e.g. `prompt_ref`).
    pub(crate) correlation_key: String,
    /// The correlation value to match forward.
    pub(crate) correlation_value: String,
    /// Bool field that marks a node terminal (e.g. `is_final`).
    pub(crate) terminal_flag_field: String,
}

impl TerminalResultSpec {
    /// The agent respond default: an `AgentResponse` correlated by `prompt_ref`,
    /// terminal when `is_final` — so the LLM path is byte-for-byte unchanged.
    pub(crate) fn agent_response(prompt_ref: impl Into<String>) -> Self {
        Self {
            node_type: AGENT_RESPONSE_NODE_TYPE.to_string(),
            correlation_key: AGENT_RESPONSE_CORRELATION_KEY.to_string(),
            correlation_value: prompt_ref.into(),
            terminal_flag_field: AGENT_RESPONSE_TERMINAL_FIELD.to_string(),
        }
    }
}

/// The terminal result a watcher found: its `content`, and whether the node
/// declared itself an error (`is_error: true`) so the watcher finalises `failed`
/// instead of `done`. A plugin (or the host, on a guest failure — finding #4)
/// can write a terminal ERROR node the same generic way it writes a success node.
#[derive(Debug)]
pub(crate) struct TerminalResult {
    pub(crate) content: String,
    pub(crate) is_error: bool,
}

pub(crate) fn extract_task_args(task: &EffortTask) -> Result<TaskArgs, String> {
    let args = &task.args;
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("query").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "sidecar: @refarm/agent::respond requires args.prompt".to_string())?
        .to_string();

    Ok(TaskArgs {
        prompt,
        system: args
            .get("system")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        session_id: args
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        history_turns: args.get("history_turns").and_then(|v| v.as_u64()),
        provider: args
            .get("provider")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        model: args
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
    })
}

// ── effort dispatch ──────────────────────────────────────────────────────────

/// Dispatch a non-`respond` effort as a generic ROUTER event. The task names a
/// `plugin_id` and a `fn` (the verb); the plugin receives the event
/// `<pluginKey>:dispatch` carrying `{verb, ...args}`, by its
/// `capabilities.subscribes` declaration, and returns its result asynchronously
/// through store-node (dispatch-result:v1). The effort is finalised the moment the
/// event is delivered (or fails to deliver) — HONESTLY: `done` only when a
/// subscriber actually received it, `failed` when it was undeliverable, never the
/// optimistic `done result:None` for an unrouted event.
pub(crate) fn dispatch_event_effort(
    state: &SidecarState,
    effort_id: &str,
    task: &crate::sidecar::EffortTask,
    fn_name: &str,
) {
    // The event name a plugin subscribes to: `<pluginKey>:dispatch`. `plugin_id`
    // is the task's target (e.g. `vault`), so `vault` -> `vault:dispatch`.
    let plugin_key = task.plugin_id.rsplit('/').next().unwrap_or(&task.plugin_id);
    let event = format!("{plugin_key}:dispatch");

    // The payload carries the verb (the effort's fn) plus the task args, so the
    // plugin's on-event handler knows which verb to run.
    let mut payload_obj = serde_json::json!({ "verb": fn_name });
    if !task.args.is_null() {
        if let Some(map) = task.args.as_object() {
            for (k, v) in map {
                payload_obj[k] = v.clone();
            }
        } else {
            payload_obj["args"] = task.args.clone();
        }
    }
    let payload = payload_obj.to_string();

    let sent = crate::deliver_via_router(
        &state.event_router,
        &state.plugin_channels,
        &state.telemetry,
        &event,
        Some(&task.plugin_id),
        Some(payload),
    );

    if sent > 0 {
        tracing::info!(effort_id = %effort_id, %event, plugin_id = %task.plugin_id, "dispatched event effort via router");
        // `delivered`, not `done`: delivery is the effort's whole job here. The
        // verb result lands asynchronously as a dispatch-result:v1 node the caller
        // reads back by replyRef; the effort records that the event was delivered,
        // not the node (which the graph owns). Marking `done` would lie — `done`
        // asserts the effort itself carries a completed task result.
        finalise_effort(
            state,
            effort_id,
            super::EFFORT_DELIVERED,
            vec![TaskResult {
                status: "ok".to_string(),
                result: Some(serde_json::json!({ "dispatched": event, "sent": sent })),
                error: None,
            }],
        );
    } else {
        finalise_effort(
            state,
            effort_id,
            "failed",
            vec![TaskResult {
                status: "error".to_string(),
                result: None,
                error: Some(format!(
                    "no plugin subscribed to '{event}' (is '{}' loaded and does its manifest declare subscribes:[{event}]?)",
                    task.plugin_id
                )),
            }],
        );
    }
}

pub(crate) fn dispatch_effort(state: SidecarState, effort: Effort) {
    // Retain the original Effort (tasks/args) so retry can re-dispatch it — the
    // efforts result store keeps only EffortResult, which has no tasks. In-process
    // only; not persisted.
    state
        .efforts_input
        .write()
        .expect("efforts_input poisoned")
        .insert(effort.id.clone(), effort.clone());

    tokio::spawn(async move {
        let effort_id = effort.id.clone();
        let submitted_at = effort.submitted_at.clone();

        // Mark in-progress — our own dispatch work is now running. (Was the
        // non-contract literal "active"; see EFFORT_IN_PROGRESS.) Non-terminal,
        // so completed_at stays None.
        record_effort_result(
            &state,
            EffortResult {
                effort_id: effort_id.clone(),
                status: super::EFFORT_IN_PROGRESS.to_string(),
                results: vec![],
                submitted_at: submitted_at.clone(),
                completed_at: None,
            },
        );

        let task = match effort.tasks.first() {
            Some(t) => t.clone(),
            None => {
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some("effort has no tasks".to_string()),
                    }],
                );
                return;
            }
        };

        let fn_name = task.fn_name.as_deref().unwrap_or("respond").to_string();

        // Two entries, one dispatcher. `respond` is the agent's prompt flow (below,
        // streamed to the client). Any OTHER fn is a generic EVENT dispatch: the
        // task's `<pluginId>:dispatch` event is routed to that plugin via the
        // neutral router (it must subscribe to the event), and the plugin returns
        // its result asynchronously through store-node (the dispatch-result:v1
        // contract), not the prompt stream. This is what lets an operator dispatch
        // a non-agent plugin's verb (e.g. `vault extract`) from outside.
        if fn_name != "respond" {
            dispatch_event_effort(&state, &effort_id, &task, &fn_name);
            return;
        }

        let args = match extract_task_args(&task) {
            Ok(args) => args,
            Err(error) => {
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(error),
                    }],
                );
                return;
            }
        };
        let prompt_ref = prompt_ref_from_effort(&effort_id);
        let stream_ref = stream_ref_for_prompt(&prompt_ref);
        tracing::info!(
            effort_id = %effort_id,
            source = effort.source.as_deref().unwrap_or(""),
            provider = args.provider.as_deref().unwrap_or(""),
            model = args.model.as_deref().unwrap_or(""),
            "dispatching sidecar effort to active agent"
        );

        // Build the structured payload for agent's handle_prompt.
        // Includes all session context so agent maintains conversation history.
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
        if let Some(provider) = args.provider {
            payload_obj["provider"] = Value::String(provider);
        }
        if let Some(model) = args.model {
            payload_obj["model"] = Value::String(model);
        }
        let payload = payload_obj.to_string();

        // Dispatch to the active agent channel.
        // Prefer the plugin registered via the "integration:respond" capability.
        // Fall back to the task's plugin_id for backward compatibility
        // (e.g. when loaded without a manifest in dev mode).
        let agent_id = state
            .default_responder_id
            .read()
            .expect("default_responder_id poisoned")
            .clone()
            .unwrap_or_else(|| task.plugin_id.clone());

        let sent = {
            let channels = state.plugin_channels.read().expect("channels poisoned");
            channels.get(&agent_id).map(|tx| {
                tx.send(crate::EventEnvelope::fire(
                    "user:prompt".to_string(),
                    Some(payload),
                ))
            })
        };

        match sent {
            None => {
                // Plugin not loaded — write error stream chunk so client doesn't timeout.
                let _ = write_stream_chunk(
                    &state.streams_dir,
                    &stream_ref,
                    0,
                    &format!("[agent not loaded ({agent_id}) - run refarm plugin status, then refarm plugin install or reload]"),
                    true,
                    None,
                );
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(format!("{agent_id} not loaded")),
                    }],
                );
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
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(format!("channel send error: {e}")),
                    }],
                );
            }
            Some(Ok(())) => {
                // The prompt was handed to the plugin runner thread, which produces
                // the answer asynchronously as `AgentResponse` CRDT nodes stamped
                // with this prompt_ref. The effort is NOT done on send — it stays
                // `in-progress` (recorded at dispatch start). Spawn a bounded watcher
                // that finalises the effort to `done` when the terminal (is_final)
                // AgentResponse node lands, or to `timed-out` if the agent stays
                // silent past the deadline. This closes the honest state machine:
                // the effort transitions in-progress -> done on the REAL result, not
                // a fake done on send.
                tracing::debug!(
                    effort_id = %effort_id,
                    "respond prompt handed to runner; watching for terminal AgentResponse"
                );
                // The agent's respond awaits the default terminal-result spec
                // (AgentResponse / prompt_ref / is_final) — the LLM path is
                // unchanged; the watcher itself is now generic.
                spawn_terminal_result_watcher(
                    state.clone(),
                    effort_id.clone(),
                    TerminalResultSpec::agent_response(prompt_ref.clone()),
                );
            }
        }
    });
}

pub(crate) fn finalise_effort(
    state: &SidecarState,
    effort_id: &str,
    status: &str,
    results: Vec<TaskResult>,
) {
    let result = {
        let mut s = state.efforts.write().expect("effort store poisoned");
        s.get_mut(effort_id).map(|entry| {
            entry.status = status.to_string();
            entry.results = results;
            // completed_at is stamped exactly once, here, when and only when the
            // status is terminal. A non-terminal transition (e.g. in-progress)
            // must never carry a completion timestamp — a stamped completed_at is
            // the signal a watch loop trusts to stop.
            entry.completed_at = if super::is_terminal_effort_status(status) {
                Some(chrono_now_iso())
            } else {
                None
            };
            entry.clone()
        })
    };
    if let Some(result) = result {
        if let Err(error) = persist_effort_result(&state.results_dir, &result) {
            tracing::warn!(
                effort_id = %result.effort_id,
                %error,
                "sidecar: failed to persist final effort result"
            );
        }
    }
}

/// Finalise an effort ONLY if it has not already reached a terminal state.
/// Returns true if it transitioned. Used by the respond watcher so a late result
/// landing never overwrites a terminal state a concurrent path already set (e.g.
/// a cancel that marked `cancelled`, or an error path that marked `failed`).
/// Terminal states are final — the machine does not walk backward out of them.
pub(crate) fn finalise_effort_if_active(
    state: &SidecarState,
    effort_id: &str,
    status: &str,
    results: Vec<TaskResult>,
) -> bool {
    {
        let s = state.efforts.read().expect("effort store poisoned");
        match s.get(effort_id) {
            Some(entry) if super::is_terminal_effort_status(&entry.status) => return false,
            None => return false,
            _ => {}
        }
    }
    finalise_effort(state, effort_id, status, results);
    true
}

/// How long the respond watcher waits for the agent's terminal AgentResponse
/// node before finalising the effort as `timed-out`. Overridable for tests /
/// tuning via REFARM_RESPOND_WATCH_TIMEOUT_MS; defaults to 45s to mirror the TS
/// stream-follow timeout (REFARM_STREAM_FOLLOW_TIMEOUT_MS).
/// Parse REFARM_RESPOND_WATCH_TIMEOUT_MS from env. Called ONCE at boot via
/// RespondWatchConfig::from_env; the watcher reads the resolved value off the
/// SidecarState, not env.
pub(crate) fn respond_watch_timeout_ms_from_env() -> u64 {
    std::env::var("REFARM_RESPOND_WATCH_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(45_000)
}

/// Poll interval for the respond watcher's storage reads. Matches the TS stream
/// follow cadence (100ms). Parsed ONCE at boot via RespondWatchConfig::from_env.
pub(crate) fn respond_watch_interval_ms_from_env() -> u64 {
    std::env::var("REFARM_RESPOND_WATCH_INTERVAL_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(100)
}

/// The terminal AgentResponse node for a respond effort, if present. Reads the
/// CRDT `AgentResponse` nodes for `namespace`, keeps only rows carrying our
/// `prompt_ref`, and returns the content of the first `is_final` one. Mirrors the
/// correlation the whole stack agrees on: the agent stamps `prompt_ref` onto
/// every AgentResponse node (model_stream_events.rs), derived from this effort_id.
/// Find the terminal correlated result node described by `spec`, if present.
/// Reads the CRDT read model for nodes of `spec.node_type`, keeps only rows
/// whose `spec.correlation_key` equals `spec.correlation_value`, and returns the
/// first one whose `spec.terminal_flag_field` is true. Generic: the agent's
/// `AgentResponse`/`prompt_ref`/`is_final` is just the default spec — any plugin
/// writing a same-shaped node is found identically. An `is_error: true` field on
/// the node marks a terminal ERROR result (so a guest failure surfaces as
/// `failed`, not a 45s `timed-out`).
pub(crate) fn find_terminal_result(
    namespace: &str,
    spec: &TerminalResultSpec,
) -> Option<TerminalResult> {
    let storage = crate::storage::NativeStorage::open(namespace).ok()?;
    let rows = storage.query_nodes(&spec.node_type).ok()?;
    for row in rows {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
            continue;
        };
        // Only rows for THIS correlation (match forward — the derivation from
        // effort_id is lossy, so never reverse it).
        if value.get(&spec.correlation_key).and_then(|v| v.as_str())
            != Some(spec.correlation_value.as_str())
        {
            continue;
        }
        if value
            .get(&spec.terminal_flag_field)
            .and_then(|v| v.as_bool())
            == Some(true)
        {
            let content = value
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let is_error = value.get("is_error").and_then(|v| v.as_bool()) == Some(true);
            return Some(TerminalResult { content, is_error });
        }
    }
    None
}

/// Watch for the terminal RESULT node an effort awaits (described by `spec`) and
/// finalise the effort accordingly. A terminal success node finalises `done`; a
/// terminal `is_error` node finalises `failed` (a guest error surfaces here
/// instead of a 45s false `timed-out`); no terminal node by the deadline
/// finalises `timed-out`.
///
/// Generic over the result node — the agent's AgentResponse is just the default
/// spec. Uses `finalise_effort_if_active` so a concurrent cancel/error that
/// already made the effort terminal wins (the watcher never walks the machine
/// backward out of a terminal state). Bounded by a deadline so a silent producer
/// never leaks the task.
fn spawn_terminal_result_watcher(state: SidecarState, effort_id: String, spec: TerminalResultSpec) {
    tokio::spawn(async move {
        let timeout = std::time::Duration::from_millis(state.respond_watch.timeout_ms);
        let interval = std::time::Duration::from_millis(state.respond_watch.interval_ms);
        let deadline = std::time::Instant::now() + timeout;

        loop {
            // Stop early if a concurrent path already finalised the effort
            // (e.g. a cancel). No point polling a terminal effort.
            {
                let s = state.efforts.read().expect("effort store poisoned");
                match s.get(&effort_id) {
                    Some(entry) if super::is_terminal_effort_status(&entry.status) => return,
                    None => return,
                    _ => {}
                }
            }

            if let Some(result) = find_terminal_result(&state.namespace, &spec) {
                if result.is_error {
                    finalise_effort_if_active(
                        &state,
                        &effort_id,
                        super::EFFORT_FAILED,
                        vec![TaskResult {
                            status: "error".to_string(),
                            result: None,
                            error: Some(result.content),
                        }],
                    );
                } else {
                    finalise_effort_if_active(
                        &state,
                        &effort_id,
                        super::EFFORT_DONE,
                        vec![TaskResult {
                            status: "ok".to_string(),
                            result: Some(serde_json::json!({ "content": result.content })),
                            error: None,
                        }],
                    );
                }
                return;
            }

            if std::time::Instant::now() >= deadline {
                let finalised = finalise_effort_if_active(
                    &state,
                    &effort_id,
                    "timed-out",
                    vec![TaskResult {
                        status: "timeout".to_string(),
                        result: None,
                        error: Some(format!(
                            "no terminal {} within {}ms",
                            spec.node_type, state.respond_watch.timeout_ms
                        )),
                    }],
                );
                if finalised {
                    tracing::warn!(
                        effort_id = %effort_id,
                        node_type = %spec.node_type,
                        "effort timed out waiting for a terminal result node"
                    );
                }
                return;
            }

            tokio::time::sleep(interval).await;
        }
    });
}

pub(crate) fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Simple ISO 8601 without chrono dependency
    let (y, mo, d, h, mi, s) = epoch_to_parts(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

pub(crate) fn epoch_to_parts(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let mins = secs / 60;
    let mi = mins % 60;
    let hours = mins / 60;
    let h = hours % 24;
    let mut days = hours / 24; // days since 1970-01-01
                               // Walk years linearly. The previous block-of-400/100/4 approximation had a
                               // real calendar bug (it mis-counted leap days within a 4-year block, drifting
                               // the day-of-month by up to a day); a linear walk is exact and mutually
                               // invertible with reap::parse_iso_to_epoch_secs. Timestamps are cheap and
                               // rare (one per effort finalise), so the linear scan cost is irrelevant.
    let mut year = 1970u64;
    loop {
        let year_days = if is_leap_year(year) { 366 } else { 365 };
        if days < year_days {
            break;
        }
        days -= year_days;
        year += 1;
    }
    let month_days = month_lengths(is_leap_year(year));
    let mut day = days;
    let mut month = 1u64;
    for &md in month_days.iter() {
        if day < md {
            break;
        }
        day -= md;
        month += 1;
    }
    (year, month, day + 1, h, mi, s)
}

pub(crate) fn is_leap_year(year: u64) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

pub(crate) fn month_lengths(leap: bool) -> [u64; 12] {
    if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    }
}

// ── route handlers ────────────────────────────────────────────────────────────
