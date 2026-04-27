use super::{prompt_persistence, react};

pub(crate) fn handle_prompt(prompt: String) {
    let Some((prompt_ref, session_id)) = prompt_persistence::store_prompt_and_open_session(&prompt)
    else {
        return;
    };

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

    prompt_persistence::store_agent_turn(
        &prompt_ref,
        &session_id,
        &content,
        tool_calls,
        &model,
        tokens_in,
        tokens_out,
        duration_ms,
    );

    let provider_name = crate::provider_name_from_env();
    prompt_persistence::store_usage_record(
        &prompt_ref,
        &provider_name,
        &model,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        &usage_raw,
        duration_ms,
    );
}
