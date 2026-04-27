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

    let mut wire_msgs = crate::provider_runtime::initial_openai_wire_messages(system, messages);

    let mut usage_totals = crate::provider_runtime::UsageTotals::default();
    let mut executed_calls: Vec<serde_json::Value> = Vec::new();
    let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for iter_idx in 0..=max_iter {
        let v = crate::provider_runtime::openai_iteration_response(
            provider, base_url, model, &wire_msgs, &base_hdrs,
        )?;

        crate::provider_runtime::ingest_openai_usage_from_response(&mut usage_totals, &v);

        let phase = crate::provider_runtime::openai_iteration_phase(&v);

        if let Some(content) = crate::provider_runtime::completion_text_if_terminate(
            crate::provider_runtime::openai_has_tool_calls(&phase),
            iter_idx,
            max_iter,
            crate::provider_runtime::require_openai_message_content(&phase.msg, &v),
        )? {
            return Ok(crate::provider_runtime::completion_result_from_response(
                content,
                executed_calls,
                &v,
                usage_totals,
            ));
        }

        crate::provider_runtime::advance_openai_tool_phase_from_phase_with(
            &mut wire_msgs,
            &phase,
            &mut executed_calls,
            &mut seen_hashes,
            crate::provider_runtime::dispatch_tool_dedup,
        );
    }
    unreachable!()
}
