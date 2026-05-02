use super::{prompt_persistence, react_loop::react_with_prompt_ref, streaming_sink};

pub(crate) struct PromptExecutionOutcome {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: String,
}

pub(crate) fn execute_prompt(
    prompt: &str,
    system_override: Option<&str>,
) -> Option<PromptExecutionOutcome> {
    let Some(ctx) = prompt_persistence::store_prompt_and_open_session(prompt) else {
        return None;
    };

    let previous_system = std::env::var("LLM_SYSTEM").ok();
    if let Some(system) = system_override {
        std::env::set_var("LLM_SYSTEM", system);
    }

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
    ) = react_with_prompt_ref(prompt, Some(&ctx.prompt_ref));
    let duration_ms = crate::now_ns().saturating_sub(t0) / 1_000_000;
    let streaming_enabled = crate::streaming_config::stream_responses_enabled_from_env();
    let last_partial_sequence = streaming_sink::take_active_stream_last_sequence();
    let response_sequence =
        crate::streaming_chunks::final_response_sequence(streaming_enabled, last_partial_sequence);

    match (system_override, previous_system) {
        (Some(_), Some(previous)) => std::env::set_var("LLM_SYSTEM", previous),
        (Some(_), None) => std::env::remove_var("LLM_SYSTEM"),
        (None, _) => {}
    }

    prompt_persistence::store_agent_turn(
        &ctx.prompt_ref,
        &ctx.session_id,
        prompt_persistence::AgentTurnRecord {
            content: content.clone(),
            tool_calls,
            model: model.clone(),
            tokens_in,
            tokens_out,
            duration_ms,
            sequence: response_sequence,
        },
    );

    let provider_name = crate::provider_name_from_env();
    prompt_persistence::store_usage_record(
        &ctx.prompt_ref,
        prompt_persistence::UsageRecordInput {
            provider_name: provider_name.clone(),
            model: model.clone(),
            tokens_in,
            tokens_out,
            tokens_cached,
            tokens_reasoning,
            usage_raw: usage_raw.clone(),
            duration_ms,
        },
    );

    Some(PromptExecutionOutcome {
        content,
        model,
        provider: provider_name,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        usage_raw,
    })
}

pub(crate) fn handle_prompt(prompt: String) {
    let _ = execute_prompt(&prompt, None);
}
