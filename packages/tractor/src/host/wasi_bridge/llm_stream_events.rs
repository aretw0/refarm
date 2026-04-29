use crate::streaming::parse_sse_data_events;

#[derive(Debug, Clone, PartialEq, Eq)]
struct LlmStreamTextChunkDraft {
    sequence: u32,
    content_delta: String,
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

#[cfg_attr(not(test), allow(dead_code))]
fn stream_text_chunk_drafts_from_sse(
    bytes: &[u8],
    last_sequence: Option<u32>,
) -> Vec<LlmStreamTextChunkDraft> {
    let mut next_sequence = last_sequence
        .map(|sequence| sequence.saturating_add(1))
        .unwrap_or(0);
    parse_stream_text_deltas_from_sse(bytes)
        .into_iter()
        .map(|content_delta| {
            let chunk = LlmStreamTextChunkDraft {
                sequence: next_sequence,
                content_delta,
            };
            next_sequence = next_sequence.saturating_add(1);
            chunk
        })
        .collect()
}

#[cfg_attr(not(test), allow(dead_code))]
fn last_stream_text_chunk_sequence(chunks: &[LlmStreamTextChunkDraft]) -> Option<u32> {
    chunks.last().map(|chunk| chunk.sequence)
}

#[cfg_attr(not(test), allow(dead_code))]
fn store_stream_agent_response_chunks_from_sse(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    bytes: &[u8],
) -> Result<(Option<u32>, u32), String> {
    let chunks = stream_text_chunk_drafts_from_sse(bytes, metadata.last_sequence);
    let mut last_stored_sequence = metadata.last_sequence;
    let mut stored_chunks = 0u32;

    for chunk in chunks {
        let node_id = stream_agent_response_chunk_id();
        let node = stream_agent_response_chunk_node(&node_id, now_ns(), metadata, &chunk);
        sync.store_node(
            &node_id,
            "AgentResponse",
            None,
            &node.to_string(),
            Some(source_plugin),
        )
        .map_err(|e| format!("store stream AgentResponse chunk: {e}"))?;
        last_stored_sequence = Some(chunk.sequence);
        stored_chunks = stored_chunks.saturating_add(1);
    }

    Ok((last_stored_sequence, stored_chunks))
}

fn stream_agent_response_chunk_id() -> String {
    format!("urn:tractor:agent-response:{}", uuid::Uuid::new_v4())
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0)
}

#[cfg_attr(not(test), allow(dead_code))]
fn stream_agent_response_chunk_node(
    node_id: &str,
    timestamp_ns: u64,
    metadata: &StreamResponseMetadata,
    chunk: &LlmStreamTextChunkDraft,
) -> serde_json::Value {
    serde_json::json!({
        "@type":        "AgentResponse",
        "@id":          node_id,
        "prompt_ref":   metadata.prompt_ref,
        "content":      chunk.content_delta,
        "sequence":     chunk.sequence,
        "is_final":     false,
        "tool_calls":   [],
        "timestamp_ns": timestamp_ns,
        "llm": {
            "model":       metadata.model,
            "tokens_in":   0,
            "tokens_out":  0,
            "duration_ms": 0,
        },
    })
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
