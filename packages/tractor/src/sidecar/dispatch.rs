//! The sidecar's async effort execution engine: SidecarState-threaded
//! dispatch of respond (agent prompt) and non-respond (router event) efforts,
//! plus finalisation and time helpers. Extracted verbatim from mod.rs; the
//! model, persistence, and stream helpers stay in the parent and are imported.

use axum::response::IntoResponse;
use axum::http::StatusCode;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{deliver_via_router, AgentMessage};
use super::{
    err, persist_effort_result, prompt_ref_from_effort, record_effort_result,
    stream_ref_for_prompt, write_stream_chunk, Effort, EffortResult, EffortTask,
    SidecarState, TaskResult,
};

#[derive(Debug)]
pub(crate) struct TaskArgs {
    pub(crate) prompt: String,
    pub(crate) system: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) history_turns: Option<u64>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
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
    let plugin_key = task
        .plugin_id
        .rsplit('/')
        .next()
        .unwrap_or(&task.plugin_id);
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
        &state.agent_channels,
        &state.telemetry,
        &event,
        Some(&task.plugin_id),
        Some(payload),
    );

    if sent > 0 {
        tracing::info!(effort_id = %effort_id, %event, plugin_id = %task.plugin_id, "dispatched event effort via router");
        finalise_effort(
            state,
            effort_id,
            "done",
            vec![TaskResult {
                status: "ok".to_string(),
                // The verb result lands asynchronously as a dispatch-result:v1 node
                // the caller reads back by replyRef; the effort records that the
                // event was delivered, not the node (which the graph owns).
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
    tokio::spawn(async move {
        let effort_id = effort.id.clone();
        let submitted_at = effort.submitted_at.clone();

        // Mark active
        record_effort_result(
            &state,
            EffortResult {
                effort_id: effort_id.clone(),
                status: "active".to_string(),
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
        // Prefer the plugin registered via the "agent:respond" capability.
        // Fall back to the task's plugin_id for backward compatibility
        // (e.g. when loaded without a manifest in dev mode).
        let agent_id = state
            .active_agent_id
            .read()
            .expect("active_agent_id poisoned")
            .clone()
            .unwrap_or_else(|| task.plugin_id.clone());

        let sent = {
            let channels = state.agent_channels.read().expect("channels poisoned");
            channels.get(&agent_id).map(|tx| {
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
                // Success — the plugin runner thread will write stream chunks.
                // Mark done optimistically; a future improvement polls the CRDT for the real result.
                finalise_effort(
                    &state,
                    &effort_id,
                    "done",
                    vec![TaskResult {
                        status: "ok".to_string(),
                        result: None,
                        error: None,
                    }],
                );
            }
        }
    });
}

pub(crate) fn finalise_effort(state: &SidecarState, effort_id: &str, status: &str, results: Vec<TaskResult>) {
    let result = {
        let mut s = state.efforts.write().expect("effort store poisoned");
        s.get_mut(effort_id).map(|entry| {
            entry.status = status.to_string();
            entry.results = results;
            entry.completed_at = Some(chrono_now_iso());
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
    let leap = (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);
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

