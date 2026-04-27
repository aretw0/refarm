use crate::refarm::plugin::tractor_bridge;

fn store_node(node: &serde_json::Value) -> bool {
    tractor_bridge::store_node(&node.to_string()).is_ok()
}

pub(crate) fn store_prompt_and_open_session(prompt: &str) -> Option<(String, String)> {
    let prompt_ref = crate::new_pi_urn("prompt");
    let prompt_node = crate::user_prompt_node(&prompt_ref, prompt);
    if !store_node(&prompt_node) {
        return None;
    }

    let session_id = crate::get_or_create_session();
    let _ = crate::append_to_session(&session_id, "user", prompt);
    Some((prompt_ref, session_id))
}

pub(crate) fn store_agent_turn(
    prompt_ref: &str,
    session_id: &str,
    content: &str,
    tool_calls: serde_json::Value,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    duration_ms: u64,
) {
    let response = crate::agent_response_node(crate::AgentResponsePayload {
        prompt_ref,
        content,
        tool_calls,
        model,
        tokens_in,
        tokens_out,
        duration_ms,
    });
    let _ = store_node(&response);

    let _ = crate::append_to_session(session_id, "agent", content);
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn store_usage_record(
    prompt_ref: &str,
    provider_name: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    tokens_cached: u32,
    tokens_reasoning: u32,
    usage_raw: &str,
    duration_ms: u64,
) {
    let usage = crate::usage_record_node(crate::UsageRecordPayload {
        prompt_ref,
        provider: provider_name,
        model,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        usage_raw,
        duration_ms,
    });
    let _ = store_node(&usage);
}
