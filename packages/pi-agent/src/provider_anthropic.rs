use crate::provider::CompletionResult;

pub(crate) fn complete(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let hdrs = crate::provider_runtime::anthropic_headers();
    let max_iter = crate::provider_runtime::tool_loop_max_iter();

    // In-flight messages: start from CRDT history, grow with tool call/result turns.
    let mut wire_msgs = crate::provider_runtime::initial_anthropic_wire_messages(messages);

    let mut usage_totals = crate::provider_runtime::UsageTotals::default();
    let mut executed_calls: Vec<serde_json::Value> = Vec::new();
    let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for iter_idx in 0..=max_iter {
        let body = crate::provider_runtime::build_anthropic_body(
            model,
            system,
            &wire_msgs,
            crate::tools_anthropic(),
        );

        let v = crate::provider_runtime::execute_json_request(
            "anthropic",
            "https://api.anthropic.com",
            "/v1/messages",
            &hdrs,
            &body,
        )?;

        crate::provider_runtime::ingest_anthropic_usage_from_response(&mut usage_totals, &v);

        let content_arr = crate::provider_runtime::anthropic_content_array(&v);
        let tool_uses = crate::provider_runtime::parse_anthropic_tool_uses(&content_arr);

        if crate::provider_runtime::should_terminate_tool_loop(
            !tool_uses.is_empty(),
            iter_idx,
            max_iter,
        ) {
            let text = crate::provider_runtime::require_anthropic_text_content(&content_arr, &v)?;
            return Ok(crate::provider_runtime::completion_result_from_response(
                text,
                executed_calls,
                &v,
                usage_totals,
            ));
        }

        crate::provider_runtime::append_anthropic_assistant_message(&mut wire_msgs, &content_arr);

        let mut tool_results = Vec::with_capacity(tool_uses.len());
        for tc in &tool_uses {
            let result =
                crate::provider_runtime::dispatch_tool_dedup(&tc.name, &tc.input, &mut seen_hashes);
            tool_results.push(crate::provider_runtime::record_anthropic_tool_execution(
                &mut executed_calls,
                tc,
                &result,
            ));
        }
        crate::provider_runtime::append_anthropic_tool_results_message(
            &mut wire_msgs,
            tool_results,
        );
    }
    unreachable!()
}
