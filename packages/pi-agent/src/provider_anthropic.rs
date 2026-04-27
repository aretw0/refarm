use crate::provider::CompletionResult;

pub(crate) fn complete(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let hdrs = crate::provider_runtime::anthropic_headers();
    let max_iter = crate::provider_runtime::tool_loop_max_iter();

    // In-flight messages: start from CRDT history, grow with tool call/result turns.
    let mut state = crate::provider_runtime::provider_loop_state(
        crate::provider_runtime::initial_anthropic_wire_messages(messages),
    );

    for iter_idx in 0..=max_iter {
        let v = crate::provider_runtime::anthropic_iteration_response(
            model,
            system,
            &state.wire_msgs,
            &hdrs,
        )?;

        crate::provider_runtime::ingest_anthropic_usage_from_response(&mut state.usage_totals, &v);

        let phase = crate::provider_runtime::anthropic_iteration_phase(&v);

        if let Some(text) = crate::provider_runtime::completion_text_if_terminate(
            crate::provider_runtime::anthropic_has_tool_calls(&phase),
            iter_idx,
            max_iter,
            crate::provider_runtime::require_anthropic_text_content(&phase.content_arr, &v),
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
