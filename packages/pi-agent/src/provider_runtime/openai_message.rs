use super::phase_common::error_message;

pub(crate) fn openai_message_content(msg: &serde_json::Value) -> Option<String> {
    msg["content"].as_str().map(ToOwned::to_owned)
}

pub(crate) fn openai_choice_message(response: &serde_json::Value) -> &serde_json::Value {
    &response["choices"][0]["message"]
}

pub(crate) fn require_openai_message_content(
    msg: &serde_json::Value,
    response: &serde_json::Value,
) -> Result<String, String> {
    openai_message_content(msg).ok_or_else(|| error_message(response, "no content"))
}

pub(crate) fn normalize_openai_codex_response(response: serde_json::Value) -> serde_json::Value {
    if response.get("choices").is_some() {
        return response;
    }

    let mut text_parts = Vec::new();
    let mut tool_calls = Vec::new();
    if let Some(output_text) = response
        .get("output_text")
        .and_then(serde_json::Value::as_str)
    {
        text_parts.push(output_text.to_string());
    }
    if let Some(output) = response.get("output").and_then(serde_json::Value::as_array) {
        for item in output {
            match item.get("type").and_then(serde_json::Value::as_str) {
                Some("message") => collect_codex_message_text(item, &mut text_parts),
                Some("function_call") => {
                    tool_calls.push(serde_json::json!({
                        "id": item.get("call_id").or_else(|| item.get("id")).cloned().unwrap_or_default(),
                        "type": "function",
                        "function": {
                            "name": item.get("name").cloned().unwrap_or_default(),
                            "arguments": codex_function_arguments(item),
                        }
                    }));
                }
                _ => {}
            }
        }
    }

    let mut message = serde_json::json!({
        "role": "assistant",
        "content": text_parts.join(""),
    });
    if !tool_calls.is_empty() {
        message["tool_calls"] = serde_json::Value::Array(tool_calls);
    }

    serde_json::json!({
        "choices": [{"message": message}],
        "usage": response.get("usage").cloned().unwrap_or_default(),
    })
}

fn collect_codex_message_text(item: &serde_json::Value, text_parts: &mut Vec<String>) {
    if let Some(content) = item.get("content").and_then(serde_json::Value::as_array) {
        for block in content {
            let block_type = block.get("type").and_then(serde_json::Value::as_str);
            if matches!(block_type, Some("output_text" | "text")) {
                if let Some(text) = block.get("text").and_then(serde_json::Value::as_str) {
                    text_parts.push(text.to_string());
                }
            }
        }
    }
}

fn codex_function_arguments(item: &serde_json::Value) -> serde_json::Value {
    if let Some(arguments) = item.get("arguments").and_then(serde_json::Value::as_str) {
        return serde_json::Value::String(arguments.to_string());
    }
    if let Some(input) = item.get("input") {
        return serde_json::Value::String(input.to_string());
    }
    serde_json::Value::String("{}".to_string())
}
