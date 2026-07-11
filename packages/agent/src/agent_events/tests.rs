//! Native tests for the AgentEvent payload shapers — pure, no wasm/host needed.
//! They pin the `agent:*` event schema an observer relies on: every payload carries
//! `prompt_ref` (the run correlation key), and each phase's distinguishing fields.

use super::*;

#[test]
fn every_event_name_carries_the_routed_prefix() {
    for name in [
        EVENT_PROMPT_START,
        EVENT_ITERATION,
        EVENT_TOOL_CALL,
        EVENT_RESPONSE_DONE,
        EVENT_ERROR,
        EVENT_BUDGET_BLOCKED,
    ] {
        assert!(
            name.starts_with(AGENT_EVENT_PREFIX),
            "{name} must start with the observer-routed prefix {AGENT_EVENT_PREFIX}"
        );
    }
}

#[test]
fn prompt_start_carries_the_run_correlation_and_session() {
    let p = prompt_start_payload("urn:refarm:prompt-1", "urn:session:a");
    assert_eq!(p["prompt_ref"], "urn:refarm:prompt-1");
    assert_eq!(p["session_id"], "urn:session:a");
}

#[test]
fn iteration_carries_index_and_max_for_runaway_detection() {
    let p = iteration_payload("r-1", 3, 25);
    assert_eq!(p["prompt_ref"], "r-1");
    assert_eq!(p["iteration"], 3);
    assert_eq!(p["max"], 25);
}

#[test]
fn tool_call_carries_name_ok_and_a_bounded_args_summary() {
    let p = tool_call_payload("r-1", "read_file", r#"{"path":"a.rs"}"#, true);
    assert_eq!(p["tool"], "read_file");
    assert_eq!(p["ok"], true);
    assert_eq!(p["args_summary"], r#"{"path":"a.rs"}"#);
    // A failed call is marked, not dropped.
    let e = tool_call_payload("r-1", "bash", "argv=[…]", false);
    assert_eq!(e["ok"], false);
}

#[test]
fn tool_call_args_summary_is_truncated_not_unbounded() {
    let huge = "x".repeat(10_000);
    let p = tool_call_payload("r-1", "write_file", &huge, true);
    let summary = p["args_summary"].as_str().unwrap();
    // Clipped to the cap (+ the ellipsis marker), never the full 10k.
    assert!(summary.chars().count() <= SUMMARY_MAX + 1, "args_summary must be bounded");
    assert!(summary.ends_with('…'), "a clipped summary must mark the cut");
}

#[test]
fn short_summary_is_passed_through_untouched() {
    assert_eq!(truncate_summary("hello"), "hello");
}

#[test]
fn response_done_reports_the_answer_shape_not_the_body() {
    let p = response_done_payload("r-1", 4096, 3, 120, 900, 4200);
    assert_eq!(p["prompt_ref"], "r-1");
    assert_eq!(p["content_len"], 4096);
    assert_eq!(p["tool_calls"], 3);
    assert_eq!(p["tokens_in"], 120);
    assert_eq!(p["tokens_out"], 900);
    assert_eq!(p["duration_ms"], 4200);
    // The full content is NOT in the event — an observer reads it from the graph.
    assert!(p.get("content").is_none());
}

#[test]
fn error_and_budget_blocked_are_distinct_terminal_signals() {
    let err = error_payload("r-1", "guest blew up: boom");
    assert_eq!(err["error"], "guest blew up: boom");
    let budget = budget_blocked_payload("r-1", "anthropic");
    assert_eq!(budget["provider"], "anthropic");
    // budget:blocked is not an error payload — an observer acts on cost differently.
    assert!(budget.get("error").is_none());
}
