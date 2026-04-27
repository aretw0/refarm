use crate::provider::{http_post_via_host, CompletionResult};

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
        let body =
            crate::provider_runtime::build_openai_body(model, &wire_msgs, crate::tools_openai());

        let bytes = http_post_via_host(
            provider,
            base_url,
            crate::provider_runtime::openai_compat_path(provider),
            &base_hdrs,
            body.as_bytes(),
        )?;
        let v = crate::provider_runtime::parse_response_json(&bytes)?;

        crate::provider_runtime::ingest_openai_usage_from_response(&mut usage_totals, &v);

        let msg = crate::provider_runtime::openai_choice_message(&v);
        let tool_calls_json = crate::provider_runtime::openai_tool_calls_array(msg);

        if crate::provider_runtime::should_terminate_tool_loop(
            !tool_calls_json.is_empty(),
            iter_idx,
            max_iter,
        ) {
            let content = crate::provider_runtime::require_openai_message_content(msg, &v)?;
            return Ok(crate::provider_runtime::completion_result_from_response(
                content,
                executed_calls,
                &v,
                usage_totals,
            ));
        }

        crate::provider_runtime::append_openai_assistant_message(
            &mut wire_msgs,
            &msg["content"],
            &tool_calls_json,
        );

        let parsed_calls = crate::provider_runtime::parse_openai_tool_calls(&tool_calls_json);
        for tc in parsed_calls {
            let result =
                crate::provider_runtime::dispatch_tool_dedup(&tc.name, &tc.input, &mut seen_hashes);
            crate::provider_runtime::record_openai_tool_execution(
                &mut executed_calls,
                &tc,
                &result,
            );
            crate::provider_runtime::append_openai_tool_message(&mut wire_msgs, &tc.id, result);
        }
    }
    unreachable!()
}
