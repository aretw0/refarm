use crate::streaming::{
    agent_response_stream_ref, parse_sse_data_events, read_sse_data_events_limited,
    stream_chunk_observation_id, stream_chunk_observation_node, StreamChunkObservationDraft,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
struct LlmStreamTextChunkDraft {
    sequence: u32,
    content_delta: String,
}

#[derive(Debug, Default)]
struct LlmStreamFinalAssembly {
    content: String,
    openai_tool_calls: Vec<OpenAiStreamToolCall>,
    anthropic_tool_uses: BTreeMap<u64, AnthropicStreamToolUse>,
    usage: LlmStreamUsage,
}

impl LlmStreamFinalAssembly {
    fn has_observations(&self) -> bool {
        !self.content.is_empty()
            || !self.openai_tool_calls.is_empty()
            || !self.anthropic_tool_uses.is_empty()
            || self.usage.has_observations()
    }
}

#[derive(Debug, Default)]
struct LlmStreamUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

impl LlmStreamUsage {
    fn has_observations(&self) -> bool {
        self.prompt_tokens.is_some()
            || self.completion_tokens.is_some()
            || self.total_tokens.is_some()
            || self.input_tokens.is_some()
            || self.output_tokens.is_some()
    }
}

#[derive(Debug, Default, Clone)]
struct OpenAiStreamToolCall {
    id: String,
    call_type: String,
    name: String,
    arguments: String,
}

#[derive(Debug, Default, Clone)]
struct AnthropicStreamToolUse {
    id: String,
    name: String,
    partial_json: String,
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
    store_stream_agent_response_chunks(sync, source_plugin, metadata, chunks)
}

#[cfg_attr(not(test), allow(dead_code))]
fn store_stream_agent_response_chunks_from_reader(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    reader: impl std::io::Read,
    max_len: usize,
) -> Result<(Vec<u8>, Option<u32>, u32), String> {
    let mut next_sequence = metadata
        .last_sequence
        .map(|sequence| sequence.saturating_add(1))
        .unwrap_or(0);
    let mut last_stored_sequence = metadata.last_sequence;
    let mut stored_chunks = 0u32;
    let mut assembly = LlmStreamFinalAssembly::default();

    let raw_body = read_sse_data_events_limited(reader, max_len, |payload| {
        let chunks = stream_text_deltas_and_update_final_assembly(payload, &mut assembly)
            .into_iter()
            .map(|content_delta| {
                let chunk = LlmStreamTextChunkDraft {
                    sequence: next_sequence,
                    content_delta,
                };
                next_sequence = next_sequence.saturating_add(1);
                chunk
            })
            .collect::<Vec<_>>();
        let (last_sequence, count) =
            store_stream_agent_response_chunks(sync, source_plugin, metadata, chunks)?;
        if last_sequence.is_some() {
            last_stored_sequence = last_sequence;
        }
        stored_chunks = stored_chunks.saturating_add(count);
        Ok(())
    })?;

    let final_body = if assembly.has_observations() {
        synthesize_stream_final_response_body(metadata, &assembly)?
    } else {
        raw_body
    };

    Ok((final_body, last_stored_sequence, stored_chunks))
}

fn synthesize_stream_final_response_body(
    metadata: &StreamResponseMetadata,
    assembly: &LlmStreamFinalAssembly,
) -> Result<Vec<u8>, String> {
    let provider_family = metadata.provider_family.trim().to_ascii_lowercase();
    let value = if provider_family == "anthropic" {
        let mut content_blocks = Vec::new();
        if !assembly.content.is_empty() {
            content_blocks.push(serde_json::json!({ "type": "text", "text": assembly.content }));
        }
        content_blocks.extend(assembly.anthropic_tool_uses.values().map(|tool_use| {
            serde_json::json!({
                "type": "tool_use",
                "id": tool_use.id,
                "name": tool_use.name,
                "input": parse_tool_arguments(&tool_use.partial_json),
            })
        }));
        serde_json::json!({
            "content": content_blocks,
            "usage": {
                "input_tokens": assembly.usage.input_tokens.unwrap_or(0),
                "output_tokens": assembly.usage.output_tokens.unwrap_or(0),
            },
        })
    } else {
        let mut message = serde_json::json!({ "role": "assistant", "content": assembly.content });
        if !assembly.openai_tool_calls.is_empty() {
            message["tool_calls"] = serde_json::Value::Array(
                assembly
                    .openai_tool_calls
                    .iter()
                    .map(|tool_call| {
                        serde_json::json!({
                            "id": tool_call.id,
                            "type": if tool_call.call_type.is_empty() { "function" } else { &tool_call.call_type },
                            "function": {
                                "name": tool_call.name,
                                "arguments": tool_call.arguments,
                            },
                        })
                    })
                    .collect(),
            );
        }
        serde_json::json!({
            "choices": [{
                "message": message,
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": assembly.usage.prompt_tokens.unwrap_or(0),
                "completion_tokens": assembly.usage.completion_tokens.unwrap_or(0),
                "total_tokens": assembly.usage.total_tokens.unwrap_or_else(|| {
                    assembly.usage.prompt_tokens.unwrap_or(0)
                        .saturating_add(assembly.usage.completion_tokens.unwrap_or(0))
                }),
            },
        })
    };
    serde_json::to_vec(&value).map_err(|e| format!("serialize stream final response: {e}"))
}

fn stream_text_deltas_and_update_final_assembly(
    payload: &str,
    assembly: &mut LlmStreamFinalAssembly,
) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    apply_stream_usage(&value, assembly);
    apply_openai_tool_call_deltas(&value, assembly);
    apply_anthropic_tool_use_delta(&value, assembly);
    let deltas = stream_text_deltas_from_value(&value);
    for delta in &deltas {
        assembly.content.push_str(delta);
    }
    deltas
}

fn apply_stream_usage(value: &serde_json::Value, assembly: &mut LlmStreamFinalAssembly) {
    if let Some(usage) = value.get("usage") {
        apply_usage_object(usage, &mut assembly.usage);
    }
    if let Some(usage) = value
        .get("message")
        .and_then(|message| message.get("usage"))
    {
        apply_usage_object(usage, &mut assembly.usage);
    }
}

fn apply_usage_object(value: &serde_json::Value, usage: &mut LlmStreamUsage) {
    if let Some(prompt_tokens) = usage_u32(value, "prompt_tokens") {
        usage.prompt_tokens = Some(prompt_tokens);
    }
    if let Some(completion_tokens) = usage_u32(value, "completion_tokens") {
        usage.completion_tokens = Some(completion_tokens);
    }
    if let Some(total_tokens) = usage_u32(value, "total_tokens") {
        usage.total_tokens = Some(total_tokens);
    }
    if let Some(input_tokens) = usage_u32(value, "input_tokens") {
        usage.input_tokens = Some(input_tokens);
    }
    if let Some(output_tokens) = usage_u32(value, "output_tokens") {
        usage.output_tokens = Some(output_tokens);
    }
}

fn usage_u32(value: &serde_json::Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
}

fn apply_openai_tool_call_deltas(value: &serde_json::Value, assembly: &mut LlmStreamFinalAssembly) {
    let Some(tool_calls) = value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|choice| choice.get("delta")?.get("tool_calls")?.as_array())
    else {
        return;
    };

    for tool_call in tool_calls {
        let index = tool_call
            .get("index")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(assembly.openai_tool_calls.len() as u64) as usize;
        while assembly.openai_tool_calls.len() <= index {
            assembly
                .openai_tool_calls
                .push(OpenAiStreamToolCall::default());
        }
        let target = &mut assembly.openai_tool_calls[index];
        if let Some(id) = tool_call.get("id").and_then(serde_json::Value::as_str) {
            target.id = id.to_string();
        }
        if let Some(call_type) = tool_call.get("type").and_then(serde_json::Value::as_str) {
            target.call_type = call_type.to_string();
        }
        if let Some(function) = tool_call.get("function") {
            if let Some(name) = function.get("name").and_then(serde_json::Value::as_str) {
                target.name = name.to_string();
            }
            if let Some(arguments) = function
                .get("arguments")
                .and_then(serde_json::Value::as_str)
            {
                target.arguments.push_str(arguments);
            }
        }
    }
}

fn apply_anthropic_tool_use_delta(
    value: &serde_json::Value,
    assembly: &mut LlmStreamFinalAssembly,
) {
    let index = value
        .get("index")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("content_block_start") => {
            let Some(block) = value.get("content_block") else {
                return;
            };
            if block.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
                return;
            }
            let entry = assembly.anthropic_tool_uses.entry(index).or_default();
            if let Some(id) = block.get("id").and_then(serde_json::Value::as_str) {
                entry.id = id.to_string();
            }
            if let Some(name) = block.get("name").and_then(serde_json::Value::as_str) {
                entry.name = name.to_string();
            }
        }
        Some("content_block_delta") => {
            let Some(delta) = value.get("delta") else {
                return;
            };
            if delta.get("type").and_then(serde_json::Value::as_str) != Some("input_json_delta") {
                return;
            }
            if let Some(partial_json) = delta
                .get("partial_json")
                .and_then(serde_json::Value::as_str)
            {
                assembly
                    .anthropic_tool_uses
                    .entry(index)
                    .or_default()
                    .partial_json
                    .push_str(partial_json);
            }
        }
        _ => {}
    }
}

fn parse_tool_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}

fn store_stream_agent_response_chunks(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunks: Vec<LlmStreamTextChunkDraft>,
) -> Result<(Option<u32>, u32), String> {
    let mut last_stored_sequence = metadata.last_sequence;
    let mut stored_chunks = 0u32;

    for chunk in chunks {
        store_stream_chunk_projection(sync, source_plugin, metadata, &chunk)?;
        last_stored_sequence = Some(chunk.sequence);
        stored_chunks = stored_chunks.saturating_add(1);
    }

    Ok((last_stored_sequence, stored_chunks))
}

fn store_stream_chunk_projection(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunk: &LlmStreamTextChunkDraft,
) -> Result<(), String> {
    let timestamp_ns = now_ns();
    store_stream_chunk_observation(sync, source_plugin, metadata, chunk, timestamp_ns)?;
    store_stream_agent_response_chunk(sync, source_plugin, metadata, chunk, timestamp_ns)
}

fn store_stream_chunk_observation(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunk: &LlmStreamTextChunkDraft,
    timestamp_ns: u64,
) -> Result<(), String> {
    let node_id = stream_chunk_observation_id();
    let draft = stream_chunk_observation_draft(metadata, chunk, timestamp_ns);
    let node = stream_chunk_observation_node(&node_id, &draft);
    sync.store_node(
        &node_id,
        "StreamChunk",
        None,
        &node.to_string(),
        Some(source_plugin),
    )
    .map_err(|e| format!("store stream chunk observation: {e}"))
}

fn store_stream_agent_response_chunk(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunk: &LlmStreamTextChunkDraft,
    timestamp_ns: u64,
) -> Result<(), String> {
    let node_id = stream_agent_response_chunk_id();
    let node = stream_agent_response_chunk_node(&node_id, timestamp_ns, metadata, chunk);
    sync.store_node(
        &node_id,
        "AgentResponse",
        None,
        &node.to_string(),
        Some(source_plugin),
    )
    .map_err(|e| format!("store stream AgentResponse chunk: {e}"))
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

fn stream_chunk_observation_draft(
    metadata: &StreamResponseMetadata,
    chunk: &LlmStreamTextChunkDraft,
    timestamp_ns: u64,
) -> StreamChunkObservationDraft {
    StreamChunkObservationDraft {
        stream_ref: agent_response_stream_ref(&metadata.prompt_ref),
        sequence: chunk.sequence,
        payload_kind: "text_delta".to_string(),
        content: chunk.content_delta.clone(),
        is_final: false,
        timestamp_ns,
        metadata: serde_json::json!({
            "projection": "AgentResponse",
            "prompt_ref": metadata.prompt_ref,
            "provider_family": metadata.provider_family,
            "model": metadata.model,
        }),
    }
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
