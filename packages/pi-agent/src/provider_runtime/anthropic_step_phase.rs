use super::{
    advance_anthropic_tool_phase_from_phase_with, anthropic_completion_text_if_terminate,
    step_common::step_text_or_advance_with, AnthropicIterationPhase, ProviderLoopState,
};

pub(crate) fn anthropic_step_text_or_advance_with<F>(
    state: &mut ProviderLoopState,
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    mut dispatch: F,
) -> Result<Option<String>, String>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        anthropic_completion_text_if_terminate,
        |state, phase| {
            advance_anthropic_tool_phase_from_phase_with(
                &mut state.wire_msgs,
                phase,
                &mut state.executed_calls,
                &mut state.seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            );
        },
    )
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_step_from_phase_with_dispatch<D>(
    state: &mut ProviderLoopState,
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: &mut D,
) -> Result<Option<String>, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    anthropic_step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        |name, input, seen_hashes| dispatch(name, input, seen_hashes),
    )
}
