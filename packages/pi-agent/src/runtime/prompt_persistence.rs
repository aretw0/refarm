use crate::refarm::plugin::tractor_bridge;

pub(crate) struct PromptContext {
    pub prompt_ref: String,
    pub session_id: String,
}

pub(crate) struct AgentTurnRecord {
    pub content: String,
    pub tool_calls: serde_json::Value,
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub duration_ms: u64,
}

pub(crate) struct UsageRecordInput {
    pub provider_name: String,
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: String,
    pub duration_ms: u64,
}

fn store_node(node: &serde_json::Value) -> bool {
    tractor_bridge::store_node(&node.to_string()).is_ok()
}

pub(crate) fn store_prompt_and_open_session(prompt: &str) -> Option<PromptContext> {
    let prompt_ref = crate::new_pi_urn("prompt");
    let prompt_node = crate::user_prompt_node(&prompt_ref, prompt);
    if !store_node(&prompt_node) {
        return None;
    }

    let session_id = crate::get_or_create_session();
    let _ = crate::append_to_session(&session_id, "user", prompt);
    Some(PromptContext {
        prompt_ref,
        session_id,
    })
}

pub(crate) fn store_agent_turn(prompt_ref: &str, session_id: &str, record: AgentTurnRecord) {
    let response = crate::agent_response_node(crate::AgentResponsePayload {
        prompt_ref,
        content: &record.content,
        tool_calls: record.tool_calls,
        model: &record.model,
        tokens_in: record.tokens_in,
        tokens_out: record.tokens_out,
        duration_ms: record.duration_ms,
        sequence: 0,
        is_final: true,
    });
    let _ = store_node(&response);

    let _ = crate::append_to_session(session_id, "agent", &record.content);
}

pub(crate) fn store_usage_record(prompt_ref: &str, usage_input: UsageRecordInput) {
    let usage = crate::usage_record_node(crate::UsageRecordPayload {
        prompt_ref,
        provider: &usage_input.provider_name,
        model: &usage_input.model,
        tokens_in: usage_input.tokens_in,
        tokens_out: usage_input.tokens_out,
        tokens_cached: usage_input.tokens_cached,
        tokens_reasoning: usage_input.tokens_reasoning,
        usage_raw: &usage_input.usage_raw,
        duration_ms: usage_input.duration_ms,
    });
    let _ = store_node(&usage);
}
