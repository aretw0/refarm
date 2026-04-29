/// Extract provider-neutral `data:` payloads from a Server-Sent Events byte stream.
///
/// This parser is intentionally target-neutral and transport-agnostic. Provider
/// JSON interpretation can evolve separately; this layer only turns an SSE byte
/// stream into ordered payload records while dropping comments and `[DONE]`.
#[cfg_attr(not(test), allow(dead_code))]
fn parse_sse_data_events(bytes: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    let mut events = Vec::new();
    let mut current_data_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            push_sse_event_data(&mut events, &mut current_data_lines);
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            current_data_lines.push(data.trim_start().to_string());
        }
    }

    push_sse_event_data(&mut events, &mut current_data_lines);
    events
}

#[cfg_attr(not(test), allow(dead_code))]
fn parse_stream_text_deltas_from_sse(bytes: &[u8]) -> Vec<String> {
    let payloads = parse_sse_data_events(bytes);
    parse_stream_text_deltas(&payloads)
}

#[cfg_attr(not(test), allow(dead_code))]
fn parse_stream_text_deltas(payloads: &[String]) -> Vec<String> {
    payloads
        .iter()
        .filter_map(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
        .flat_map(|value| stream_text_deltas_from_value(&value))
        .collect()
}

fn stream_text_deltas_from_value(value: &serde_json::Value) -> Vec<String> {
    let mut deltas = openai_text_deltas(value);
    if let Some(text) = anthropic_text_delta(value) {
        deltas.push(text.to_string());
    }
    deltas
}

fn openai_text_deltas(value: &serde_json::Value) -> Vec<String> {
    value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|choice| choice.get("delta")?.get("content")?.as_str())
        .map(str::to_string)
        .collect()
}

fn anthropic_text_delta(value: &serde_json::Value) -> Option<&str> {
    let delta = value.get("delta")?;
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("content_block_delta") => delta.get("text")?.as_str(),
        _ => None,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn push_sse_event_data(events: &mut Vec<String>, current_data_lines: &mut Vec<String>) {
    if current_data_lines.is_empty() {
        return;
    }

    let payload = current_data_lines.join("\n").trim().to_string();
    current_data_lines.clear();
    if !payload.is_empty() && payload != "[DONE]" {
        events.push(payload);
    }
}
