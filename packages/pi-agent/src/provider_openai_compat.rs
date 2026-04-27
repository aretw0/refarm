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

        let msg = crate::provider_runtime::openai_choice_message(&v);
        let tool_calls_json = crate::provider_runtime::openai_tool_calls_array(msg);

        if let Some(content) = crate::provider_runtime::completion_text_if_terminate(
            !tool_calls_json.is_empty(),
            iter_idx,
            max_iter,
            crate::provider_runtime::require_openai_message_content(msg, &v),
        )? {
            return Ok(crate::provider_runtime::completion_result_from_response(
                content,
                executed_calls,
                &v,
                usage_totals,
            ));
        }

        let parsed_calls = crate::provider_runtime::parse_openai_tool_calls(&tool_calls_json);
        crate::provider_runtime::advance_openai_tool_phase_with(
            &mut wire_msgs,
            &msg["content"],
            &tool_calls_json,
            &parsed_calls,
            &mut executed_calls,
            &mut seen_hashes,
            crate::provider_runtime::dispatch_tool_dedup,
        );
    }
    unreachable!()
}
