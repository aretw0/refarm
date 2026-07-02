#[allow(dead_code)]
pub(crate) fn build_openai_body(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    build_openai_body_with_streaming(model, wire_msgs, tools, false)
}

pub(crate) fn build_openai_body_with_streaming(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    stream: bool,
) -> String {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "tools": tools,
        "messages": wire_msgs,
    });
    if stream {
        body["stream"] = serde_json::Value::Bool(true);
    }
    body.to_string()
}

pub(crate) fn build_openai_codex_responses_body_with_streaming(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    _stream: bool,
) -> String {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for message in wire_msgs {
        let role = message["role"].as_str().unwrap_or("user");
        let content = message["content"].as_str().unwrap_or("");
        if role == "system" {
            if !content.is_empty() {
                instructions.push(content.to_string());
            }
            continue;
        }
        input.push(serde_json::json!({
            "role": role,
            "content": content,
        }));
    }
    let mut body = serde_json::json!({
        "model": model,
        "store": false,
        "stream": true,
        "input": input,
        "tools": openai_chat_tools_to_responses_tools(tools),
    });
    if !instructions.is_empty() {
        body["instructions"] = serde_json::Value::String(instructions.join("\n\n"));
    }
    body.to_string()
}

fn openai_chat_tools_to_responses_tools(tools: serde_json::Value) -> serde_json::Value {
    let Some(items) = tools.as_array() else {
        return serde_json::Value::Array(Vec::new());
    };
    serde_json::Value::Array(
        items
            .iter()
            .filter_map(|tool| {
                let function = tool.get("function")?;
                Some(serde_json::json!({
                    "type": "function",
                    "name": function.get("name").cloned().unwrap_or_default(),
                    "description": function.get("description").cloned().unwrap_or_default(),
                    "parameters": function.get("parameters").cloned().unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}})),
                }))
            })
            .collect(),
    )
}
