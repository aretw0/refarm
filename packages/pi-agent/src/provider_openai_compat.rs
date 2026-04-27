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

    let mut state = crate::provider_runtime::openai_loop_state(system, messages);

    for iter_idx in 0..=max_iter {
        let (v, phase) = crate::provider_runtime::openai_iteration_response_and_phase(
            provider,
            base_url,
            model,
            &state.wire_msgs,
            &base_hdrs,
            &mut state.usage_totals,
        )?;

        if let Some(content) = crate::provider_runtime::openai_step_text_or_advance_with(
            &mut state,
            &phase,
            iter_idx,
            max_iter,
            &v,
            crate::provider_runtime::dispatch_tool_dedup,
        )? {
            return Ok(crate::provider_runtime::finalize_completion_from_response(
                content, &v, state,
            ));
        }
    }
    unreachable!()
}
