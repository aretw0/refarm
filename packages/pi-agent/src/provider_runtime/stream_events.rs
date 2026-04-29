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

pub(crate) fn parse_stream_text_deltas_from_sse(bytes: &[u8]) -> Vec<String> {
    let payloads = parse_sse_data_events(bytes);
    parse_stream_text_deltas(&payloads)
}

pub(crate) fn parse_stream_response_chunk_drafts_from_sse(
    bytes: &[u8],
    last_sequence: Option<u32>,
) -> Vec<crate::streaming_chunks::ResponseChunkDraft> {
    let deltas = parse_stream_text_deltas_from_sse(bytes);
    crate::streaming_chunks::partial_response_chunk_drafts(&deltas, last_sequence)
}

pub(crate) fn emit_stream_response_chunk_drafts_from_sse(
    bytes: &[u8],
    last_sequence: Option<u32>,
    mut emit: impl FnMut(&crate::streaming_chunks::ResponseChunkDraft),
) -> Option<u32> {
    let drafts = parse_stream_response_chunk_drafts_from_sse(bytes, last_sequence);
    for draft in &drafts {
        emit(draft);
    }
    crate::streaming_chunks::last_response_chunk_sequence(&drafts)
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
