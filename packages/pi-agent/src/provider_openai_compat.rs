use crate::provider::{http_post_via_host, CompletionResult};

// Providers with non-standard OpenAI-compat paths; all others use /v1/chat/completions.
fn openai_compat_path(provider: &str) -> &'static str {
    match provider {
        "groq" => "/openai/v1/chat/completions",
        "openrouter" => "/api/v1/chat/completions",
        "gemini" => "/v1beta/openai/chat/completions",
        _ => "/v1/chat/completions",
    }
}

pub(crate) fn complete(
    provider: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let base_hdrs: Vec<(String, String)> =
        vec![("content-type".to_string(), "application/json".to_string())];

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
        let body = serde_json::json!({
            "model": model, "max_tokens": 1024,
            "tools": crate::tools_openai(),
            "messages": wire_msgs,
        })
        .to_string();

        let bytes = http_post_via_host(
            provider,
            base_url,
            openai_compat_path(provider),
            &base_hdrs,
            body.as_bytes(),
        )?;
        let v: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;

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

        wire_msgs.push(serde_json::json!({
            "role": "assistant",
            "content": msg["content"],
            "tool_calls": tool_calls_json,
        }));

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
            wire_msgs
                .push(serde_json::json!({"role": "tool", "tool_call_id": id, "content": result}));
        }
    }
    unreachable!()
}
