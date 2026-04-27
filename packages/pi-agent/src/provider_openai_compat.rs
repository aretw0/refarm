use crate::provider::CompletionResult;

pub(crate) fn complete(
    provider: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let base_hdrs = crate::provider_runtime::openai_compat_headers();

    let max_iter = crate::provider_runtime::tool_loop_max_iter();

    let mut state = crate::provider_runtime::provider_loop_state(
        crate::provider_runtime::initial_openai_wire_messages(system, messages),
    );

    for iter_idx in 0..=max_iter {
        let v = crate::provider_runtime::openai_iteration_response(
            provider,
            base_url,
            model,
            &state.wire_msgs,
            &base_hdrs,
        )?;

        crate::provider_runtime::ingest_openai_usage_from_response(&mut state.usage_totals, &v);

        let phase = crate::provider_runtime::openai_iteration_phase(&v);

        if let Some(content) = crate::provider_runtime::openai_completion_text_if_terminate(
            &phase, iter_idx, max_iter, &v,
        )? {
            return Ok(crate::provider_runtime::finalize_completion_from_response(
                content, &v, state,
            ));
        }

        crate::provider_runtime::advance_openai_tool_phase_from_phase_with(
            &mut state.wire_msgs,
            &phase,
            &mut state.executed_calls,
            &mut state.seen_hashes,
            crate::provider_runtime::dispatch_tool_dedup,
        );
    }
    unreachable!()
}
