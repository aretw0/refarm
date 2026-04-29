#![cfg_attr(not(test), allow(dead_code))]

/// Extract `data:` payloads from a server-sent events byte stream.
///
/// This intentionally stays provider-neutral: OpenAI-compatible and Anthropic
/// streaming responses both use SSE framing, while their JSON payload schemas
/// differ. `[DONE]` sentinels and comments are omitted.
pub(crate) fn parse_sse_data_events(bytes: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    text.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .filter(|payload| !payload.is_empty() && *payload != "[DONE]")
        .map(str::to_string)
        .collect()
}

/// Extract provider-specific text deltas from SSE JSON payloads.
pub(crate) fn parse_stream_text_deltas(payloads: &[String]) -> Vec<String> {
    payloads
        .iter()
        .filter_map(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
        .flat_map(|value| stream_text_deltas_from_value(&value))
        .collect()
}

fn stream_text_deltas_from_value(value: &serde_json::Value) -> Vec<String> {
    let mut deltas = Vec::new();
    if let Some(text) = openai_text_delta(value) {
        deltas.push(text.to_string());
    }
    if let Some(text) = anthropic_text_delta(value) {
        deltas.push(text.to_string());
    }
    deltas
}

fn openai_text_delta(value: &serde_json::Value) -> Option<&str> {
    value
        .get("choices")?
        .as_array()?
        .iter()
        .find_map(|choice| choice.get("delta")?.get("content")?.as_str())
}

fn anthropic_text_delta(value: &serde_json::Value) -> Option<&str> {
    let delta = value.get("delta")?;
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("content_block_delta") => delta.get("text")?.as_str(),
        _ => None,
    }
}
