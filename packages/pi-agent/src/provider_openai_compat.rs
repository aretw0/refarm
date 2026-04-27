use crate::tool_dispatch::dispatch_tool;

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

    let max_iter = std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5);

    let mut wire_msgs: Vec<serde_json::Value> = {
        let mut v = vec![serde_json::json!({"role": "system", "content": system})];
        v.extend(
            messages
                .iter()
                .map(|(r, c)| serde_json::json!({"role": r, "content": c})),
        );
        v
    };

    let mut tokens_in = 0u32;
    let mut tokens_out = 0u32;
    let mut tokens_cached = 0u32;
    let mut tokens_reasoning = 0u32;
    let mut last_usage_raw = "{}".to_string();
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
        tokens_in += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        tokens_out += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
        tokens_cached += usage["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        last_usage_raw = usage.to_string();

        let msg = &v["choices"][0]["message"];
        let tool_calls_json = msg["tool_calls"].as_array().cloned().unwrap_or_default();

        if tool_calls_json.is_empty() || iter_idx == max_iter {
            let content = msg["content"]
                .as_str()
                .ok_or_else(|| {
                    v["error"]["message"]
                        .as_str()
                        .unwrap_or("no content")
                        .to_owned()
                })?
                .to_owned();
            return Ok(CompletionResult {
                content,
                tool_calls: serde_json::Value::Array(executed_calls),
                tokens_in,
                tokens_out,
                tokens_cached,
                tokens_reasoning,
                usage_raw: last_usage_raw,
            });
        }

        wire_msgs.push(serde_json::json!({
            "role": "assistant",
            "content": msg["content"],
            "tool_calls": tool_calls_json,
        }));

        for tc in &tool_calls_json {
            let fn_obj = &tc["function"];
            let name = fn_obj["name"].as_str().unwrap_or("");
            let input: serde_json::Value =
                serde_json::from_str(fn_obj["arguments"].as_str().unwrap_or("{}"))
                    .unwrap_or(serde_json::json!({}));
            let id = tc["id"].as_str().unwrap_or("");
            let raw = dispatch_tool(name, &input);
            let result = if seen_hashes.insert(crate::fnv1a_hash(&raw)) {
                raw
            } else {
                "[duplicate: same output already in this context — ask for specifics if needed]"
                    .to_string()
            };
            executed_calls
                .push(serde_json::json!({"name": name, "input": input, "result": &result}));
            wire_msgs
                .push(serde_json::json!({"role": "tool", "tool_call_id": id, "content": result}));
        }
    }
    unreachable!()
}
