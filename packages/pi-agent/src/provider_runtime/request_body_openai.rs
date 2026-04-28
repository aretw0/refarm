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
