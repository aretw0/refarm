use crate::provider::CompletionResult;

pub(crate) fn complete(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let hdrs = crate::provider_runtime::anthropic_headers();
    let max_iter = crate::provider_runtime::tool_loop_max_iter();

    // In-flight messages: start from CRDT history, grow with tool call/result turns.
    let mut state = crate::provider_runtime::anthropic_loop_state(messages);

    for iter_idx in 0..=max_iter {
        let (v, phase) = crate::provider_runtime::anthropic_iteration_response_and_phase(
            model,
            system,
            &state.wire_msgs,
            &hdrs,
            &mut state.usage_totals,
        )?;

        if let Some(text) = crate::provider_runtime::anthropic_completion_text_if_terminate(
            &phase, iter_idx, max_iter, &v,
        )? {
            return Ok(crate::provider_runtime::finalize_completion_from_response(
                text, &v, state,
            ));
        }

        crate::provider_runtime::advance_anthropic_tool_phase_from_phase_with(
            &mut state.wire_msgs,
            &phase,
            &mut state.executed_calls,
            &mut state.seen_hashes,
            crate::provider_runtime::dispatch_tool_dedup,
        );
    }
    unreachable!()
}
