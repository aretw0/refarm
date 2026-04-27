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

    let mut wire_msgs: Vec<serde_json::Value> = {
        let mut v = vec![serde_json::json!({"role": "system", "content": system})];
        v.extend(
            messages
                .iter()
                .map(|(r, c)| serde_json::json!({"role": r, "content": c})),
        );
        v
    };

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

        let usage = &v["usage"];
        usage_totals.ingest_openai_usage(usage);

        let msg = &v["choices"][0]["message"];
        let tool_calls_json = msg["tool_calls"].as_array().cloned().unwrap_or_default();

        if crate::provider_runtime::should_terminate_tool_loop(
            !tool_calls_json.is_empty(),
            iter_idx,
            max_iter,
        ) {
            let content = msg["content"]
                .as_str()
                .ok_or_else(|| crate::provider_runtime::error_message(&v, "no content"))?
                .to_owned();
            return Ok(crate::provider_runtime::completion_result(
                content,
                executed_calls,
                usage,
                usage_totals,
            ));
        }

        crate::provider_runtime::append_openai_assistant_message(
            &mut wire_msgs,
            &msg["content"],
            &tool_calls_json,
        );

        for tc in &tool_calls_json {
            let fn_obj = &tc["function"];
            let name = fn_obj["name"].as_str().unwrap_or("");
            let input = crate::provider_runtime::parse_json_arguments(
                fn_obj["arguments"].as_str().unwrap_or("{}"),
            );
            let id = tc["id"].as_str().unwrap_or("");
            let result =
                crate::provider_runtime::dispatch_tool_dedup(name, &input, &mut seen_hashes);
            crate::provider_runtime::push_executed_call(&mut executed_calls, name, input, &result);
            crate::provider_runtime::append_openai_tool_message(&mut wire_msgs, id, result);
        }
    }
    unreachable!()
}
