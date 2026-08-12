//! The agent-lifecycle → activity bridge: fold the guest's fine-grained `agent:*`
//! telemetry into `process:*` ACTIVITY lines, so a surface tailing `activity.ndjson`
//! (the CLI does this globally via `followActivityFile`) renders an agent turn's live
//! progress — the route it chose, each tool it called, when it finished — for free.
//!
//! This fills the reserved `process:progress` seam (`process_activity.rs`) that had no
//! caller. The `agent:*` events reached only the audit log + opt-in observer plugins;
//! now they also drive the operator's "working" affordance across surfaces.
//!
//! Correlation: an agent turn is its OWN activity thread keyed by `prompt_ref` (the key
//! every `agent:*` payload carries). `agent:prompt:start` opens it, `response:done`/
//! `error` closes it, and route/tool/iteration/budget are progress ticks in between.
//! Keeping it self-contained by `prompt_ref` avoids a lossy `prompt_ref → effort_id`
//! reverse-map (the effort id's dashes are stripped in `prompt_ref`).
//!
//! Pure: `agent_event_to_activity` maps (event name, payload) → an optional activity
//! payload, native-testable with no bus/fs. The observer writes the result.

use serde_json::Value;

use crate::telemetry::process_activity;

/// The activity `kind` an agent turn reports under — the open work vocabulary a surface
/// may theme. Distinct from the effort dispatcher's `"agent"`/`"dispatch"` so a surface
/// can tell the fine-grained lifecycle apart if it wants; most just render the label.
const AGENT_ACTIVITY_KIND: &str = "agent";

/// The label an agent turn's activity carries (the operator-facing name). The per-step
/// detail rides in the progress `note`.
const AGENT_ACTIVITY_LABEL: &str = "Agent turn";

/// Read `prompt_ref` from an `agent:*` payload — the activity correlation key. Returns
/// `None` (skip) when absent/blank, so a malformed event never writes a keyless line.
fn prompt_ref(payload: &Value) -> Option<&str> {
    payload
        .get("prompt_ref")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Map one `agent:*` event to a `process:*` activity payload, or `None` for events that
/// do not drive the operator affordance. PURE.
///
/// - `agent:prompt:start`   → `process:started`  (the turn began)
/// - `agent:route:selected` → `process:progress` note "route <provider> (<source>)"
/// - `agent:iteration`      → `process:progress` note "step N/max" + fraction
/// - `agent:tool:call`      → `process:progress` note "tool <name>" (or "tool <name> ✗")
/// - `agent:budget:blocked` → `process:progress` note "budget blocked: <provider>"
/// - `agent:budget:unknown` → `process:progress` note "budget unknown: <provider> (<reason>)"
/// - `agent:response:done`  → `process:finished` ok=true
/// - `agent:error`          → `process:finished` ok=false
pub(crate) fn agent_event_to_activity(event: &str, payload: &Value) -> Option<Value> {
    let reference = prompt_ref(payload)?;
    match event {
        crate::agent_event_names::PROMPT_START => Some(process_activity::started_payload(
            reference,
            AGENT_ACTIVITY_LABEL,
            AGENT_ACTIVITY_KIND,
        )),
        crate::agent_event_names::ROUTE_SELECTED => {
            let provider = payload.get("provider").and_then(Value::as_str).unwrap_or("?");
            let source = payload.get("source").and_then(Value::as_str).unwrap_or("");
            let note = if source.is_empty() {
                format!("route {provider}")
            } else {
                format!("route {provider} ({source})")
            };
            Some(process_activity::progress_payload(
                reference,
                AGENT_ACTIVITY_LABEL,
                AGENT_ACTIVITY_KIND,
                Some(&note),
                None,
            ))
        }
        crate::agent_event_names::ITERATION => {
            let index = payload.get("iteration").and_then(Value::as_u64);
            let max = payload.get("max").and_then(Value::as_u64);
            let (note, fraction) = match (index, max) {
                (Some(i), Some(m)) if m > 0 => (
                    format!("step {}/{}", i + 1, m),
                    Some((i + 1) as f64 / m as f64),
                ),
                (Some(i), _) => (format!("step {}", i + 1), None),
                _ => ("working".to_string(), None),
            };
            Some(process_activity::progress_payload(
                reference,
                AGENT_ACTIVITY_LABEL,
                AGENT_ACTIVITY_KIND,
                Some(&note),
                fraction,
            ))
        }
        crate::agent_event_names::TOOL_CALL => {
            let tool = payload.get("tool").and_then(Value::as_str).unwrap_or("?");
            let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(true);
            let note = if ok {
                format!("tool {tool}")
            } else {
                format!("tool {tool} ✗")
            };
            Some(process_activity::progress_payload(
                reference,
                AGENT_ACTIVITY_LABEL,
                AGENT_ACTIVITY_KIND,
                Some(&note),
                None,
            ))
        }
        crate::agent_event_names::BUDGET_BLOCKED => {
            let provider = payload.get("provider").and_then(Value::as_str).unwrap_or("?");
            let note = format!("budget blocked: {provider}");
            Some(process_activity::progress_payload(
                reference,
                AGENT_ACTIVITY_LABEL,
                AGENT_ACTIVITY_KIND,
                Some(&note),
                None,
            ))
        }
        crate::agent_event_names::BUDGET_UNKNOWN => {
            let provider = payload.get("provider").and_then(Value::as_str).unwrap_or("?");
            let reason = payload.get("reason").and_then(Value::as_str).unwrap_or("?");
            let note = format!("budget unknown: {provider} ({reason})");
            Some(process_activity::progress_payload(
                reference,
                AGENT_ACTIVITY_LABEL,
                AGENT_ACTIVITY_KIND,
                Some(&note),
                None,
            ))
        }
        crate::agent_event_names::RESPONSE_DONE => Some(process_activity::finished_payload(
            reference,
            AGENT_ACTIVITY_LABEL,
            AGENT_ACTIVITY_KIND,
            true,
        )),
        crate::agent_event_names::ERROR => Some(process_activity::finished_payload(
            reference,
            AGENT_ACTIVITY_LABEL,
            AGENT_ACTIVITY_KIND,
            false,
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(reference: &str) -> Value {
        json!({ "prompt_ref": reference })
    }

    #[test]
    fn skips_events_without_a_prompt_ref() {
        assert!(agent_event_to_activity("agent:prompt:start", &json!({})).is_none());
        assert!(agent_event_to_activity("agent:prompt:start", &json!({ "prompt_ref": "" })).is_none());
    }

    #[test]
    fn prompt_start_opens_a_started_activity_keyed_by_prompt_ref() {
        let a = agent_event_to_activity("agent:prompt:start", &p("urn:p-1")).unwrap();
        assert_eq!(a["activityRef"], "urn:p-1");
        assert_eq!(a["phase"], "started");
        assert_eq!(a["kind"], "agent");
    }

    #[test]
    fn route_selected_is_a_progress_note() {
        let mut payload = p("urn:p-1");
        payload["provider"] = json!("ollama");
        payload["source"] = json!("profile:cheap");
        let a = agent_event_to_activity("agent:route:selected", &payload).unwrap();
        assert_eq!(a["phase"], "progress");
        assert_eq!(a["note"], "route ollama (profile:cheap)");
    }

    #[test]
    fn iteration_carries_a_fraction() {
        let mut payload = p("urn:p-1");
        payload["iteration"] = json!(2);
        payload["max"] = json!(10);
        let a = agent_event_to_activity("agent:iteration", &payload).unwrap();
        assert_eq!(a["note"], "step 3/10");
        assert_eq!(a["fraction"], json!(0.3));
    }

    #[test]
    fn the_last_step_of_a_run_renders_as_n_of_n_never_n_plus_one_of_n() {
        // The display half of the off-by-one. `agent:iteration` carried a 0-based
        // index against `max_iter`, which the agent's loop read as a maximum
        // INDEX and not a count: a 25-step ceiling ran 26 iterations, and this
        // renderer printed the last one as `step 26/25` with a progress fraction
        // of 1.04. The agent now emits a COUNT (`loop_core.rs`), so the highest
        // index this can ever receive for a 25-step run is 24.
        let mut payload = p("urn:p-1");
        payload["iteration"] = json!(24);
        payload["max"] = json!(25);
        let a = agent_event_to_activity("agent:iteration", &payload).unwrap();
        assert_eq!(a["note"], "step 25/25");
        assert_eq!(a["fraction"], json!(1.0), "a full run is 100% done, never 104%");
    }

    #[test]
    fn tool_call_marks_failures() {
        let mut ok = p("urn:p-1");
        ok["tool"] = json!("read_file");
        ok["ok"] = json!(true);
        assert_eq!(agent_event_to_activity("agent:tool:call", &ok).unwrap()["note"], "tool read_file");

        let mut bad = p("urn:p-1");
        bad["tool"] = json!("bash");
        bad["ok"] = json!(false);
        assert_eq!(agent_event_to_activity("agent:tool:call", &bad).unwrap()["note"], "tool bash ✗");
    }

    #[test]
    fn response_done_and_error_close_the_activity_with_ok_flag() {
        let done = agent_event_to_activity("agent:response:done", &p("urn:p-1")).unwrap();
        assert_eq!(done["phase"], "finished");
        assert_eq!(done["ok"], json!(true));

        let err = agent_event_to_activity("agent:error", &p("urn:p-1")).unwrap();
        assert_eq!(err["phase"], "finished");
        assert_eq!(err["ok"], json!(false));
    }

    #[test]
    fn budget_blocked_is_a_progress_note() {
        let mut payload = p("urn:p-1");
        payload["provider"] = json!("anthropic");
        let a = agent_event_to_activity("agent:budget:blocked", &payload).unwrap();
        assert_eq!(a["phase"], "progress");
        assert_eq!(a["note"], "budget blocked: anthropic");
    }

    #[test]
    fn budget_unknown_is_a_progress_note_naming_the_reason() {
        // The "loud" half of the agent's FAIL-OPEN-BUT-LOUD budget policy must reach
        // the same operator-facing surface `budget:blocked` does — the CLI tails
        // `activity.ndjson`, not the audit log or an opt-in observer plugin.
        //
        // BOTH REASONS ARE REACHABLE, and this comment used to say otherwise (ISS-037).
        // It claimed that "as of the agent's round-2 budget-guard fix, only `query_error`
        // is ever actually emitted", which went stale the moment `RequeryTruncated`
        // became a returned value: `session::pure::resolve_budget_check` yields it when
        // the FOLLOW-UP read comes back truncated too, and that path is live today.
        //
        // No functional impact — this formatter is reason-string-agnostic by design, and
        // that is exactly why the drift could sit here: nothing failed, the comment simply
        // stopped being true. `BudgetUnknownReason` in the agent crate is the source of
        // truth for which strings exist.
        let mut payload = p("urn:p-1");
        payload["provider"] = json!("anthropic");
        payload["reason"] = json!("truncated");
        let a = agent_event_to_activity("agent:budget:unknown", &payload).unwrap();
        assert_eq!(a["phase"], "progress");
        assert_eq!(a["note"], "budget unknown: anthropic (truncated)");

        let mut qerr = p("urn:p-1");
        qerr["provider"] = json!("anthropic");
        qerr["reason"] = json!("query_error");
        let b = agent_event_to_activity("agent:budget:unknown", &qerr).unwrap();
        assert_eq!(b["note"], "budget unknown: anthropic (query_error)");
    }

    #[test]
    fn unknown_agent_events_produce_no_activity() {
        assert!(agent_event_to_activity("agent:something:new", &p("urn:p-1")).is_none());
    }
}
