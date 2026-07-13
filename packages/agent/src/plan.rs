//! Agent task-plan model — the pure shape + rendering behind the `update_plan` tool
//! (the TodoWrite of the references). Kept OUT of the wasm-gated `tool_dispatch` so it
//! is native-testable; the wasm wrapper (`tool_dispatch::plan_tools`) supplies the
//! session id + clock and does the `store-node`.
//!
//! A plan is an `AgentPlan` graph node keyed by the session, so writing it again
//! REPLACES it (a living list, not an append log). It reuses the ADR-057 status
//! vocabulary and the same store-node seam the session ops use — no new host surface.

use serde_json::{json, Value};

/// The plan node's `@type` and id scheme — one plan per session (update overwrites).
const PLAN_NODE_TYPE: &str = "AgentPlan";
const PLAN_ID_PREFIX: &str = "urn:sovereign:agent-plan:v1:";

/// Normalize a step status to the harness todo vocabulary (aligned with ADR-057
/// `TaskStatus`: `pending`/`in_progress`(=active)/`done`/`blocked`). Anything else
/// becomes `pending`, so a slightly-off status never drops a step.
pub(crate) fn normalize_status(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "in_progress" | "in-progress" | "active" | "doing" => "in_progress",
        "done" | "complete" | "completed" | "finished" => "done",
        "blocked" | "stuck" => "blocked",
        _ => "pending",
    }
}

/// Build the `AgentPlan` node for `session_id` from the tool's `steps` array
/// (`[{step, status}]`) — PURE. Each item becomes `{step, status}` (status normalized);
/// a step with empty text is dropped. Returns the node + the count kept.
pub(crate) fn build_plan_node(session_id: &str, steps: &Value, now_ns: u64) -> (Value, usize) {
    let items: Vec<Value> = steps
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let text = item.get("step").and_then(Value::as_str)?.trim();
                    if text.is_empty() {
                        return None;
                    }
                    let status = item
                        .get("status")
                        .and_then(Value::as_str)
                        .map(normalize_status)
                        .unwrap_or("pending");
                    Some(json!({ "step": text, "status": status }))
                })
                .collect()
        })
        .unwrap_or_default();
    let count = items.len();
    let node = json!({
        "@id": format!("{PLAN_ID_PREFIX}{session_id}"),
        "@type": PLAN_NODE_TYPE,
        "context_id": session_id,
        "steps": items,
        "updated_at_ns": now_ns,
    });
    (node, count)
}

/// A compact, model-facing summary of a stored plan — each step with a status glyph,
/// the way TodoWrite echoes the list. PURE over the node value.
pub(crate) fn render_plan_summary(node: &Value, count: usize) -> String {
    if count == 0 {
        return "[plan cleared — no steps]".to_string();
    }
    let mut out = format!("Plan updated ({count} step{}):", if count == 1 { "" } else { "s" });
    if let Some(steps) = node["steps"].as_array() {
        for item in steps {
            let glyph = match item["status"].as_str().unwrap_or("pending") {
                "done" => "✓",
                "in_progress" => "▸",
                "blocked" => "✗",
                _ => "•",
            };
            let text = item["step"].as_str().unwrap_or("");
            out.push_str(&format!("\n  {glyph} {text}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{build_plan_node, normalize_status, render_plan_summary};
    use serde_json::json;

    #[test]
    fn builds_a_plan_node_keyed_by_session() {
        let steps = json!([
            { "step": "read the file", "status": "done" },
            { "step": "make the edit", "status": "in_progress" },
            { "step": "run tests", "status": "pending" },
        ]);
        let (node, count) = build_plan_node("sess-1", &steps, 42);
        assert_eq!(count, 3);
        assert_eq!(node["@id"], "urn:sovereign:agent-plan:v1:sess-1");
        assert_eq!(node["@type"], "AgentPlan");
        assert_eq!(node["context_id"], "sess-1");
        assert_eq!(node["updated_at_ns"], 42);
        assert_eq!(node["steps"][0]["status"], "done");
        assert_eq!(node["steps"][1]["status"], "in_progress");
    }

    #[test]
    fn same_session_yields_same_id_so_an_update_replaces() {
        let (a, _) = build_plan_node("s", &json!([{"step":"x"}]), 1);
        let (b, _) = build_plan_node("s", &json!([{"step":"y"}]), 2);
        assert_eq!(a["@id"], b["@id"]); // stable id → store overwrites, not appends
    }

    #[test]
    fn normalizes_status_aliases_and_defaults_unknown_to_pending() {
        assert_eq!(normalize_status("in-progress"), "in_progress");
        assert_eq!(normalize_status("Doing"), "in_progress");
        assert_eq!(normalize_status("completed"), "done");
        assert_eq!(normalize_status("stuck"), "blocked");
        assert_eq!(normalize_status("weird"), "pending");
        assert_eq!(normalize_status(""), "pending");
    }

    #[test]
    fn drops_steps_with_empty_text() {
        let steps = json!([{ "step": "  " }, { "step": "real" }, { "status": "done" }]);
        let (node, count) = build_plan_node("s", &steps, 0);
        assert_eq!(count, 1);
        assert_eq!(node["steps"][0]["step"], "real");
    }

    #[test]
    fn missing_status_defaults_to_pending() {
        let (node, _) = build_plan_node("s", &json!([{ "step": "x" }]), 0);
        assert_eq!(node["steps"][0]["status"], "pending");
    }

    #[test]
    fn renders_a_summary_with_status_glyphs() {
        let steps = json!([{ "step": "a", "status": "done" }, { "step": "b", "status": "pending" }]);
        let (node, count) = build_plan_node("s", &steps, 0);
        let summary = render_plan_summary(&node, count);
        assert!(summary.contains("Plan updated (2 steps)"));
        assert!(summary.contains("✓ a"));
        assert!(summary.contains("• b"));
    }

    #[test]
    fn an_empty_plan_renders_as_cleared() {
        let (node, count) = build_plan_node("s", &json!([]), 0);
        assert_eq!(render_plan_summary(&node, count), "[plan cleared — no steps]");
    }
}
