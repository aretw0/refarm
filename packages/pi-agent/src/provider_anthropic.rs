use crate::provider::{http_post_via_host, CompletionResult};

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

        let bytes = http_post_via_host(
            "anthropic",
            "https://api.anthropic.com",
            "/v1/messages",
            &hdrs,
            body.as_bytes(),
        )?;
        let v = crate::provider_runtime::parse_response_json(&bytes)?;

        let usage = &v["usage"];
        usage_totals.ingest_anthropic_usage(usage);

        let content_arr = crate::provider_runtime::anthropic_content_array(&v);
        let tool_uses = crate::provider_runtime::parse_anthropic_tool_uses(&content_arr);

        if crate::provider_runtime::should_terminate_tool_loop(
            !tool_uses.is_empty(),
            iter_idx,
            max_iter,
        ) {
            let text = crate::provider_runtime::anthropic_text_content(&content_arr)
                .ok_or_else(|| crate::provider_runtime::error_message(&v, "no text in response"))?;
            return Ok(crate::provider_runtime::completion_result(
                text,
                executed_calls,
                usage,
                usage_totals,
            ));
        }

        crate::provider_runtime::append_anthropic_assistant_message(&mut wire_msgs, &content_arr);

        let mut tool_results = Vec::with_capacity(tool_uses.len());
        for tc in &tool_uses {
            let result =
                crate::provider_runtime::dispatch_tool_dedup(&tc.name, &tc.input, &mut seen_hashes);
            crate::provider_runtime::push_executed_call(
                &mut executed_calls,
                &tc.name,
                tc.input.clone(),
                &result,
            );
            tool_results.push(crate::provider_runtime::anthropic_tool_result(
                &tc.id, result,
            ));
        }
        crate::provider_runtime::append_anthropic_tool_results_message(
            &mut wire_msgs,
            tool_results,
        );
    }
    unreachable!()
}
