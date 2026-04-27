use crate::provider::{http_post_via_host, CompletionResult};

pub(crate) fn complete(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    let hdrs = vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("anthropic-version".to_string(), "2023-06-01".to_string()),
    ];
    let max_iter = crate::provider_runtime::tool_loop_max_iter();

    // In-flight messages: start from CRDT history, grow with tool call/result turns.
    let mut wire_msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|(role, content)| serde_json::json!({"role": role, "content": content}))
        .collect();

    let mut usage_totals = crate::provider_runtime::UsageTotals::default();
    let mut executed_calls: Vec<serde_json::Value> = Vec::new();
    let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for iter_idx in 0..=max_iter {
        let body = serde_json::json!({
            "model": model, "max_tokens": 1024, "system": system,
            "tools": crate::tools_anthropic(),
            "messages": wire_msgs,
        })
        .to_string();

        let bytes = http_post_via_host(
            "anthropic",
            "https://api.anthropic.com",
            "/v1/messages",
            &hdrs,
            body.as_bytes(),
        )?;
        let v: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;

        let usage = &v["usage"];
        usage_totals.ingest_anthropic_usage(usage);

        // Collect tool_use blocks from content array.
        let content_arr = v["content"].as_array().cloned().unwrap_or_default();
        let tool_uses: Vec<&serde_json::Value> = content_arr
            .iter()
            .filter(|c| c["type"] == "tool_use")
            .collect();

        if tool_uses.is_empty() || iter_idx == max_iter {
            let text = content_arr
                .iter()
                .find(|c| c["type"] == "text")
                .and_then(|c| c["text"].as_str())
                .ok_or_else(|| {
                    v["error"]["message"]
                        .as_str()
                        .unwrap_or("no text in response")
                        .to_owned()
                })?
                .to_owned();
            return Ok(crate::provider_runtime::completion_result(
                text,
                executed_calls,
                usage,
                usage_totals,
            ));
        }

        wire_msgs.push(serde_json::json!({"role": "assistant", "content": content_arr}));

        let mut tool_results = Vec::with_capacity(tool_uses.len());
        for tc in &tool_uses {
            let name = tc["name"].as_str().unwrap_or("");
            let input = &tc["input"];
            let id = tc["id"].as_str().unwrap_or("");
            let result =
                crate::provider_runtime::dispatch_tool_dedup(name, input, &mut seen_hashes);
            crate::provider_runtime::push_executed_call(
                &mut executed_calls,
                name,
                input.clone(),
                &result,
            );
            tool_results.push(
                serde_json::json!({"type": "tool_result", "tool_use_id": id, "content": result}),
            );
        }
        wire_msgs.push(serde_json::json!({"role": "user", "content": tool_results}));
    }
    unreachable!()
}
