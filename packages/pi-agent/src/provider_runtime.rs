pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

pub(crate) fn anthropic_headers() -> Vec<(String, String)> {
    vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("anthropic-version".to_string(), "2023-06-01".to_string()),
    ]
}

pub(crate) fn openai_compat_headers() -> Vec<(String, String)> {
    vec![("content-type".to_string(), "application/json".to_string())]
}

pub(crate) fn openai_compat_path(provider: &str) -> &'static str {
    match provider {
        "groq" => "/openai/v1/chat/completions",
        "openrouter" => "/api/v1/chat/completions",
        "gemini" => "/v1beta/openai/chat/completions",
        _ => "/v1/chat/completions",
    }
}

pub(crate) fn build_anthropic_body(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn build_openai_body(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn parse_response_json(bytes: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))
}

pub(crate) fn initial_anthropic_wire_messages(
    messages: &[(String, String)],
) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|(role, content)| serde_json::json!({"role": role, "content": content}))
        .collect()
}

pub(crate) fn initial_openai_wire_messages(
    system: &str,
    messages: &[(String, String)],
) -> Vec<serde_json::Value> {
    let mut v = vec![serde_json::json!({"role": "system", "content": system})];
    v.extend(
        messages
            .iter()
            .map(|(r, c)| serde_json::json!({"role": r, "content": c})),
    );
    v
}

pub(crate) fn anthropic_content_array(v: &serde_json::Value) -> Vec<serde_json::Value> {
    v["content"].as_array().cloned().unwrap_or_default()
}

pub(crate) fn openai_tool_calls_array(msg: &serde_json::Value) -> Vec<serde_json::Value> {
    msg["tool_calls"].as_array().cloned().unwrap_or_default()
}

pub(crate) struct ParsedAnthropicToolUse {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) fn parse_anthropic_tool_uses(
    content_arr: &[serde_json::Value],
) -> Vec<ParsedAnthropicToolUse> {
    content_arr
        .iter()
        .filter(|c| c["type"] == "tool_use")
        .map(|c| ParsedAnthropicToolUse {
            name: c["name"].as_str().unwrap_or("").to_owned(),
            input: c["input"].clone(),
            id: c["id"].as_str().unwrap_or("").to_owned(),
        })
        .collect()
}

pub(crate) fn anthropic_text_content(content_arr: &[serde_json::Value]) -> Option<String> {
    content_arr
        .iter()
        .find(|c| c["type"] == "text")
        .and_then(|c| c["text"].as_str())
        .map(ToOwned::to_owned)
}

pub(crate) struct ParsedOpenAiToolCall {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) fn parse_openai_tool_calls(
    tool_calls_json: &[serde_json::Value],
) -> Vec<ParsedOpenAiToolCall> {
    tool_calls_json
        .iter()
        .map(|tc| {
            let fn_obj = &tc["function"];
            ParsedOpenAiToolCall {
                name: fn_obj["name"].as_str().unwrap_or("").to_owned(),
                input: parse_json_arguments(fn_obj["arguments"].as_str().unwrap_or("{}")),
                id: tc["id"].as_str().unwrap_or("").to_owned(),
            }
        })
        .collect()
}

pub(crate) fn openai_message_content(msg: &serde_json::Value) -> Option<String> {
    msg["content"].as_str().map(ToOwned::to_owned)
}

pub(crate) fn anthropic_tool_result(tool_use_id: &str, content: String) -> serde_json::Value {
    serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    })
}

pub(crate) fn dedup_tool_output(
    raw: String,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    if seen_hashes.insert(crate::fnv1a_hash(&raw)) {
        raw
    } else {
        "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    let raw = crate::tool_dispatch::dispatch_tool(name, input);
    dedup_tool_output(raw, seen_hashes)
}

pub(crate) fn push_executed_call(
    executed_calls: &mut Vec<serde_json::Value>,
    name: &str,
    input: serde_json::Value,
    result: &str,
) {
    executed_calls.push(serde_json::json!({
        "name": name,
        "input": input,
        "result": result,
    }));
}

pub(crate) fn parse_json_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}

pub(crate) fn append_anthropic_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content_arr,
    }));
}

pub(crate) fn append_anthropic_tool_results_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
) {
    wire_msgs.push(serde_json::json!({
        "role": "user",
        "content": tool_results,
    }));
}

pub(crate) fn append_openai_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls_json,
    }));
}

pub(crate) fn append_openai_tool_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_call_id: &str,
    content: String,
) {
    wire_msgs.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    }));
}

pub(crate) fn should_terminate_tool_loop(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
) -> bool {
    !has_tool_calls || iter_idx == max_iter
}

pub(crate) fn error_message(v: &serde_json::Value, fallback: &str) -> String {
    v["error"]["message"]
        .as_str()
        .unwrap_or(fallback)
        .to_owned()
}

#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
            + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
            as u32;
    }

    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += usage["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        self.tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result(
    content: String,
    executed_calls: Vec<serde_json::Value>,
    usage: &serde_json::Value,
    totals: UsageTotals,
) -> crate::provider::CompletionResult {
    crate::provider::CompletionResult {
        content,
        tool_calls: serde_json::Value::Array(executed_calls),
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        tokens_cached: totals.tokens_cached,
        tokens_reasoning: totals.tokens_reasoning,
        usage_raw: usage.to_string(),
    }
}
