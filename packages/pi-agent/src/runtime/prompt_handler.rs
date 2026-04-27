use crate::refarm::plugin::tractor_bridge;

use super::react;

fn store_node(node: &serde_json::Value) -> bool {
    tractor_bridge::store_node(&node.to_string()).is_ok()
}

pub(crate) fn handle_prompt(prompt: String) {
    let prompt_ref = crate::new_pi_urn("prompt");

    let prompt_node = crate::user_prompt_node(&prompt_ref, &prompt);
    if !store_node(&prompt_node) {
        return;
    }

    let session_id = crate::get_or_create_session();
    let user_entry_id = crate::append_to_session(&session_id, "user", &prompt);

    let t0 = crate::now_ns();
    let (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        model,
        usage_raw,
    ) = react(&prompt);
    let duration_ms = crate::now_ns().saturating_sub(t0) / 1_000_000;

    let response = crate::agent_response_node(crate::AgentResponsePayload {
        prompt_ref: &prompt_ref,
        content: &content,
        tool_calls,
        model: &model,
        tokens_in,
        tokens_out,
        duration_ms,
    });
    let _ = store_node(&response);

    let _ = crate::append_to_session(&session_id, "agent", &content);
    let _ = user_entry_id;

    let provider_name = crate::provider_name_from_env();
    let usage = crate::usage_record_node(crate::UsageRecordPayload {
        prompt_ref: &prompt_ref,
        provider: &provider_name,
        model: &model,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        usage_raw: &usage_raw,
        duration_ms,
    });
    let _ = store_node(&usage);
}
