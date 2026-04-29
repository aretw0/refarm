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
    pub sequence: u32,
}

pub(crate) struct AgentResponseChunkRecord {
    pub content: String,
    pub tool_calls: serde_json::Value,
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub duration_ms: u64,
    pub sequence: u32,
    pub is_final: bool,
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

/// Metadata defaults applied to partial response chunk drafts before storage.
#[allow(dead_code)]
pub(crate) struct AgentResponseChunkDefaults {
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
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

pub(crate) fn store_agent_response_chunk(
    prompt_ref: &str,
    record: AgentResponseChunkRecord,
) -> bool {
    let response = crate::agent_response_node(crate::AgentResponsePayload {
        prompt_ref,
        content: &record.content,
        tool_calls: record.tool_calls,
        model: &record.model,
        tokens_in: record.tokens_in,
        tokens_out: record.tokens_out,
        duration_ms: record.duration_ms,
        sequence: record.sequence,
        is_final: record.is_final,
    });
    store_node(&response)
}

/// Store partial response chunk drafts as AgentResponse nodes without session history append.
#[allow(dead_code)]
pub(crate) fn store_agent_response_chunk_drafts(
    prompt_ref: &str,
    drafts: &[crate::streaming_chunks::ResponseChunkDraft],
    defaults: AgentResponseChunkDefaults,
) -> usize {
    drafts
        .iter()
        .filter(|draft| store_agent_response_chunk_draft(prompt_ref, draft, &defaults))
        .count()
}

fn store_agent_response_chunk_draft(
    prompt_ref: &str,
    draft: &crate::streaming_chunks::ResponseChunkDraft,
    defaults: &AgentResponseChunkDefaults,
) -> bool {
    store_agent_response_chunk(
        prompt_ref,
        AgentResponseChunkRecord {
            content: draft.content.clone(),
            tool_calls: serde_json::Value::Null,
            model: defaults.model.clone(),
            tokens_in: defaults.tokens_in,
            tokens_out: defaults.tokens_out,
            duration_ms: defaults.duration_ms,
            sequence: draft.sequence,
            is_final: draft.is_final,
        },
    )
}

/// Parse SSE bytes into partial chunks and store them as AgentResponse nodes.
#[allow(dead_code)]
pub(crate) fn store_agent_response_chunks_from_sse(
    prompt_ref: &str,
    bytes: &[u8],
    last_sequence: Option<u32>,
    defaults: AgentResponseChunkDefaults,
) -> (Option<u32>, usize) {
    let mut stored = 0usize;
    let mut last_stored_sequence = None;
    let _last_emitted = crate::provider_runtime::emit_stream_response_chunk_drafts_from_sse(
        bytes,
        last_sequence,
        |draft| {
            if store_agent_response_chunk_draft(prompt_ref, draft, &defaults) {
                stored += 1;
                last_stored_sequence = Some(draft.sequence);
            }
        },
    );
    (last_stored_sequence, stored)
}

pub(crate) fn store_agent_turn(prompt_ref: &str, session_id: &str, record: AgentTurnRecord) {
    let content = record.content.clone();
    let _ = store_agent_response_chunk(
        prompt_ref,
        AgentResponseChunkRecord {
            content: record.content,
            tool_calls: record.tool_calls,
            model: record.model,
            tokens_in: record.tokens_in,
            tokens_out: record.tokens_out,
            duration_ms: record.duration_ms,
            sequence: record.sequence,
            is_final: true,
        },
    );

    if crate::streaming_chunks::should_append_response_chunk_to_session(true) {
        let _ = crate::append_to_session(session_id, "agent", &content);
    }
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
