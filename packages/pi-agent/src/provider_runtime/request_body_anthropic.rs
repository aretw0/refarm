pub(crate) fn build_anthropic_body(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    build_anthropic_body_with_streaming(model, system, wire_msgs, tools, false)
}

pub(crate) fn build_anthropic_body_with_streaming(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    stream: bool,
) -> String {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "tools": tools,
        "messages": wire_msgs,
    });
    if stream {
        body["stream"] = serde_json::Value::Bool(true);
    }
    body.to_string()
}
