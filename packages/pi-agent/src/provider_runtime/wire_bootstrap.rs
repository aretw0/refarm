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
