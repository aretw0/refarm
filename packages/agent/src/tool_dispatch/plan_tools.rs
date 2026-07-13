//! `update_plan` — the wasm wrapper for the agent's task-plan tool (the TodoWrite of
//! the references). The pure shape + rendering live in `crate::plan` (native-tested);
//! this only supplies the current session id + clock and does the `store-node`.

use serde_json::Value;

/// The `update_plan` tool: build the plan node for the current session
/// (`MODEL_SESSION_ID`) and store it, replacing any prior plan. Returns the rendered
/// summary. Without a session id there is nothing to key the plan to, so it reports
/// that rather than writing an orphan node.
pub(crate) fn update_plan(input: &Value) -> String {
    let session_id = match std::env::var("MODEL_SESSION_ID") {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return "[error] update_plan needs an active session (MODEL_SESSION_ID unset)".into(),
    };
    let (node, count) = crate::plan::build_plan_node(&session_id, &input["steps"], crate::utils::now_ns());
    match crate::plugin::host::tractor_bridge::store_node(&node.to_string()) {
        Ok(_) => crate::plan::render_plan_summary(&node, count),
        Err(e) => format!("[error] failed to store plan: {e:?}"),
    }
}
