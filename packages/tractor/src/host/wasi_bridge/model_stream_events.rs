use crate::streaming::{
    agent_response_stream_ref, parse_sse_data_events, read_sse_data_events_limited,
    stream_chunk_observation_id, stream_chunk_observation_node, stream_session_observation_id,
    stream_session_observation_node, StreamChunkObservationDraft, StreamSessionObservationDraft,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ModelStreamTextChunkDraft {
    sequence: u32,
    content_delta: String,
}

#[derive(Debug, Default)]
struct ModelStreamFinalAssembly {
    content: String,
    openai_tool_calls: Vec<OpenAiStreamToolCall>,
    anthropic_tool_uses: BTreeMap<u64, AnthropicStreamToolUse>,
    usage: ModelStreamUsage,
}

impl ModelStreamFinalAssembly {
    fn has_observations(&self) -> bool {
        !self.content.is_empty()
            || !self.openai_tool_calls.is_empty()
            || !self.anthropic_tool_uses.is_empty()
            || self.usage.has_observations()
    }
}

#[derive(Debug, Default)]
struct ModelStreamUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

impl ModelStreamUsage {
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
) -> Vec<ModelStreamTextChunkDraft> {
    let mut next_sequence = last_sequence
        .map(|sequence| sequence.saturating_add(1))
        .unwrap_or(0);
    parse_stream_text_deltas_from_sse(bytes)
        .into_iter()
        .map(|content_delta| {
            let chunk = ModelStreamTextChunkDraft {
                sequence: next_sequence,
                content_delta,
            };
            next_sequence = next_sequence.saturating_add(1);
            chunk
        })
        .collect()
}

#[cfg_attr(not(test), allow(dead_code))]
fn last_stream_text_chunk_sequence(chunks: &[ModelStreamTextChunkDraft]) -> Option<u32> {
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
    let stream_started_at_ns = now_ns();
    store_stream_session_observation(
        sync,
        source_plugin,
        &stream_session_observation_draft(
            metadata,
            crate::streaming::STREAM_SESSION_STATUS_ACTIVE,
            stream_started_at_ns,
            stream_started_at_ns,
            None,
            metadata.last_sequence,
            0,
        ),
    )?;

    let mut next_sequence = metadata
        .last_sequence
        .map(|sequence| sequence.saturating_add(1))
        .unwrap_or(0);
    let mut last_stored_sequence = metadata.last_sequence;
    let mut stored_chunks = 0u32;
    let mut assembly = ModelStreamFinalAssembly::default();

    let raw_body = match read_sse_data_events_limited(reader, max_len, |payload| {
        let chunks = stream_text_deltas_and_update_final_assembly(payload, &mut assembly)
            .into_iter()
            .map(|content_delta| {
                let chunk = ModelStreamTextChunkDraft {
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
    }) {
        Ok(raw_body) => raw_body,
        Err(err) => {
            let stream_failed_at_ns = now_ns();
            let mut failed_session = stream_session_observation_draft(
                metadata,
                crate::streaming::STREAM_SESSION_STATUS_FAILED,
                stream_started_at_ns,
                stream_failed_at_ns,
                Some(stream_failed_at_ns),
                last_stored_sequence,
                stored_chunks,
            );
            annotate_stream_session_failure(&mut failed_session, &err);
            store_stream_session_observation(sync, source_plugin, &failed_session)?;
            return Err(err);
        }
    };

    let has_final_observation = assembly.has_observations();
    let final_observation_sequence = has_final_observation
        .then(|| final_stream_sequence(metadata.last_sequence, last_stored_sequence));
    let final_body = if let Some(sequence) = final_observation_sequence {
        let body = synthesize_stream_final_response_body(metadata, &assembly)?;
        store_stream_final_chunk_observation(
            sync,
            source_plugin,
            metadata,
            sequence,
            final_stream_payload_kind(&assembly),
            &assembly.content,
        )?;
        // Host is the SOLE owner of the ndjson file on the streaming path: having
        // written every partial delta (append_partial_stream_ndjson), it also
        // writes the single final line — a content:"" end-marker, since the deltas
        // already carried the whole answer. The guest skips its own final write
        // when partials were produced, so exactly one writer touches the file.
        append_final_stream_ndjson(metadata, sequence);
        body
    } else {
        raw_body
    };

    let stream_completed_at_ns = now_ns();
    store_stream_session_observation(
        sync,
        source_plugin,
        &stream_session_observation_draft(
            metadata,
            crate::streaming::STREAM_SESSION_STATUS_COMPLETED,
            stream_started_at_ns,
            stream_completed_at_ns,
            Some(stream_completed_at_ns),
            final_observation_sequence.or(last_stored_sequence),
            stored_chunks.saturating_add(u32::from(has_final_observation)),
        ),
    )?;

    Ok((final_body, last_stored_sequence, stored_chunks))
}

fn synthesize_stream_final_response_body(
    metadata: &StreamResponseMetadata,
    assembly: &ModelStreamFinalAssembly,
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
    assembly: &mut ModelStreamFinalAssembly,
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

fn apply_stream_usage(value: &serde_json::Value, assembly: &mut ModelStreamFinalAssembly) {
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

fn apply_usage_object(value: &serde_json::Value, usage: &mut ModelStreamUsage) {
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

/// Upper bound on the OpenAI streaming tool-call index. `index` comes from the
/// UPSTREAM model SSE stream (untrusted); the dense Vec grows to `index+1`, so
/// without a cap a chunk with `index: 4_000_000_000` would push ~4B defaults and
/// OOM the daemon. Real streams emit a handful of parallel tool calls; 1024 is
/// far beyond any legitimate count. (The Anthropic sibling is safe already — it
/// uses a sparse BTreeMap keyed by index.)
const MAX_OPENAI_TOOL_CALL_INDEX: usize = 1024;

fn apply_openai_tool_call_deltas(value: &serde_json::Value, assembly: &mut ModelStreamFinalAssembly) {
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
        // Cap the model-controlled index so a pathological value can't grow the
        // dense Vec without bound (remote OOM). Beyond the cap, drop the delta.
        if index > MAX_OPENAI_TOOL_CALL_INDEX {
            continue;
        }
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
    assembly: &mut ModelStreamFinalAssembly,
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
    chunks: Vec<ModelStreamTextChunkDraft>,
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
    chunk: &ModelStreamTextChunkDraft,
) -> Result<(), String> {
    let timestamp_ns = now_ns();
    store_stream_chunk_observation(sync, source_plugin, metadata, chunk, timestamp_ns)?;
    // The tractor host is the delta producer under host-proxied streaming, so it
    // also owns the partial ndjson spine the CLI tails: mirror each parsed delta
    // as an is_final:false line into {stream_ref}.ndjson. Best-effort — a stream
    // file that can't be written must not fail the model call; the CRDT projection
    // remains the source of truth. Only PARTIALS are written here; the guest owns
    // the single final line (an empty end-marker when partials preceded it).
    append_partial_stream_ndjson(metadata, chunk);
    store_stream_agent_response_chunk(sync, source_plugin, metadata, chunk, timestamp_ns)
}

/// Append one partial delta line to `{REFARM_STREAMS_DIR}/{stream_ref}.ndjson`.
/// No-op when REFARM_STREAMS_DIR is unset/empty or on any IO error — the ndjson
/// spine is a delivery convenience, never a correctness dependency.
fn append_partial_stream_ndjson(
    metadata: &StreamResponseMetadata,
    chunk: &ModelStreamTextChunkDraft,
) {
    let streams_dir = match std::env::var("REFARM_STREAMS_DIR") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return,
    };
    let stream_ref = agent_response_stream_ref(&metadata.prompt_ref);
    let file_path = format!("{streams_dir}/{stream_ref}.ndjson");
    if std::fs::create_dir_all(&streams_dir).is_err() {
        return;
    }
    let line = serde_json::json!({
        "stream_ref": stream_ref,
        "sequence": chunk.sequence,
        "content": chunk.content_delta,
        "is_final": false,
        "payload_kind": "text_delta",
    });
    append_stream_ndjson_line(&file_path, &line);
}

/// Append the single final end-marker line to `{stream_ref}.ndjson`. content:""
/// because the partials already carried the whole answer (so a CLI accumulating
/// `content += chunk.content` reconstructs it exactly once). Same best-effort
/// no-op semantics as the partial writer.
fn append_final_stream_ndjson(metadata: &StreamResponseMetadata, sequence: u32) {
    let streams_dir = match std::env::var("REFARM_STREAMS_DIR") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return,
    };
    let stream_ref = agent_response_stream_ref(&metadata.prompt_ref);
    let file_path = format!("{streams_dir}/{stream_ref}.ndjson");
    if std::fs::create_dir_all(&streams_dir).is_err() {
        return;
    }
    let line = serde_json::json!({
        "stream_ref": stream_ref,
        "sequence": sequence,
        "content": "",
        "is_final": true,
        "payload_kind": "final_marker",
    });
    append_stream_ndjson_line(&file_path, &line);
}

/// Append one JSON line to an ndjson stream file. Best-effort: a stream file that
/// can't be written must never fail the model call.
fn append_stream_ndjson_line(file_path: &str, line: &serde_json::Value) {
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "{line}")
        });
}

fn store_stream_chunk_observation(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunk: &ModelStreamTextChunkDraft,
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

fn store_stream_final_chunk_observation(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    sequence: u32,
    payload_kind: &str,
    content: &str,
) -> Result<(), String> {
    let timestamp_ns = now_ns();
    let node_id = stream_chunk_observation_id();
    let draft = stream_final_chunk_observation_draft(
        metadata,
        sequence,
        payload_kind,
        content,
        timestamp_ns,
    );
    let node = stream_chunk_observation_node(&node_id, &draft);
    sync.store_node(
        &node_id,
        "StreamChunk",
        None,
        &node.to_string(),
        Some(source_plugin),
    )
    .map_err(|e| format!("store final stream chunk observation: {e}"))
}

fn store_stream_session_observation(
    sync: &NativeSync,
    source_plugin: &str,
    draft: &StreamSessionObservationDraft,
) -> Result<(), String> {
    let node_id = stream_session_observation_id(&draft.stream_ref);
    let node = stream_session_observation_node(&node_id, draft);
    sync.store_node(
        &node_id,
        "StreamSession",
        None,
        &node.to_string(),
        Some(source_plugin),
    )
    .map_err(|e| format!("store stream session observation: {e}"))
}

fn store_stream_agent_response_chunk(
    sync: &NativeSync,
    source_plugin: &str,
    metadata: &StreamResponseMetadata,
    chunk: &ModelStreamTextChunkDraft,
    timestamp_ns: u64,
) -> Result<(), String> {
    let node_id = stream_agent_response_chunk_id();
    let node = stream_agent_response_chunk_node(&node_id, timestamp_ns, metadata, chunk);
    sync.store_node(
        &node_id,
        crate::sidecar::AGENT_RESPONSE_NODE_TYPE,
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
    chunk: &ModelStreamTextChunkDraft,
    timestamp_ns: u64,
) -> StreamChunkObservationDraft {
    stream_observation_draft(
        metadata,
        chunk.sequence,
        crate::streaming::STREAM_CHUNK_PAYLOAD_KIND_TEXT_DELTA,
        &chunk.content_delta,
        false,
        timestamp_ns,
    )
}

fn stream_final_chunk_observation_draft(
    metadata: &StreamResponseMetadata,
    sequence: u32,
    payload_kind: &str,
    content: &str,
    timestamp_ns: u64,
) -> StreamChunkObservationDraft {
    stream_observation_draft(
        metadata,
        sequence,
        payload_kind,
        content,
        true,
        timestamp_ns,
    )
}

fn final_stream_payload_kind(assembly: &ModelStreamFinalAssembly) -> &'static str {
    if !assembly.content.is_empty() {
        crate::streaming::STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT
    } else if !assembly.openai_tool_calls.is_empty() || !assembly.anthropic_tool_uses.is_empty() {
        crate::streaming::STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL
    } else {
        crate::streaming::STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY
    }
}

fn stream_session_observation_draft(
    metadata: &StreamResponseMetadata,
    status: &str,
    started_at_ns: u64,
    updated_at_ns: u64,
    completed_at_ns: Option<u64>,
    last_sequence: Option<u32>,
    chunk_count: u32,
) -> StreamSessionObservationDraft {
    StreamSessionObservationDraft {
        stream_ref: agent_response_stream_ref(&metadata.prompt_ref),
        stream_kind: crate::streaming::STREAM_KIND_RESPONSE.to_string(),
        status: status.to_string(),
        started_at_ns,
        updated_at_ns,
        completed_at_ns,
        last_sequence,
        chunk_count,
        metadata: serde_json::json!({
            "projection": "Response",
            "prompt_ref": metadata.prompt_ref,
            "provider_family": metadata.provider_family,
            "model": metadata.model,
        }),
    }
}

fn annotate_stream_session_failure(draft: &mut StreamSessionObservationDraft, reason: &str) {
    draft.metadata["failure_kind"] = serde_json::json!("stream_read_failed");
    draft.metadata["failure_reason"] = serde_json::json!(sanitize_stream_failure_reason(reason));
}

fn sanitize_stream_failure_reason(reason: &str) -> String {
    reason
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(200)
        .collect()
}

fn stream_observation_draft(
    metadata: &StreamResponseMetadata,
    sequence: u32,
    payload_kind: &str,
    content: &str,
    is_final: bool,
    timestamp_ns: u64,
) -> StreamChunkObservationDraft {
    StreamChunkObservationDraft {
        stream_ref: agent_response_stream_ref(&metadata.prompt_ref),
        sequence,
        payload_kind: payload_kind.to_string(),
        content: content.to_string(),
        is_final,
        timestamp_ns,
        metadata: serde_json::json!({
            "projection": "Response",
            "prompt_ref": metadata.prompt_ref,
            "provider_family": metadata.provider_family,
            "model": metadata.model,
        }),
    }
}

fn final_stream_sequence(
    initial_last_sequence: Option<u32>,
    partial_last_sequence: Option<u32>,
) -> u32 {
    partial_last_sequence
        .or(initial_last_sequence)
        .map(|sequence| sequence.saturating_add(1))
        .unwrap_or(0)
}

#[cfg_attr(not(test), allow(dead_code))]
fn stream_agent_response_chunk_node(
    node_id: &str,
    timestamp_ns: u64,
    metadata: &StreamResponseMetadata,
    chunk: &ModelStreamTextChunkDraft,
) -> serde_json::Value {
    serde_json::json!({
        "@type":        crate::sidecar::AGENT_RESPONSE_NODE_TYPE,
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

#[cfg(test)]
mod partial_ndjson_tests {
    use super::*;
    use crate::host::plugin_host::plugin::host::model_bridge::StreamResponseMetadata;
    use crate::test_support::env_lock;

    fn meta(prompt_ref: &str) -> StreamResponseMetadata {
        StreamResponseMetadata {
            prompt_ref: prompt_ref.to_string(),
            model: "gpt-5.5".to_string(),
            provider_family: "openai".to_string(),
            last_sequence: None,
        }
    }

    #[test]
    fn partial_projection_appends_delta_lines_to_ndjson() {
        let _guard = env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("REFARM_STREAMS_DIR", dir.path());

        let m = meta("p-abc");
        for (seq, delta) in [(0u32, "Hel"), (1, "lo, "), (2, "world")] {
            append_partial_stream_ndjson(
                &m,
                &ModelStreamTextChunkDraft { sequence: seq, content_delta: delta.to_string() },
            );
        }
        std::env::remove_var("REFARM_STREAMS_DIR");

        let path = dir
            .path()
            .join("urn:tractor:stream:response:p-abc.ndjson");
        let body = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 3, "one ndjson line per delta");

        // Every line is a non-final partial carrying its own delta; joining the
        // deltas reconstructs the whole answer (the CLI's `content +=` model).
        let mut joined = String::new();
        for (i, line) in lines.iter().enumerate() {
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(v["is_final"], false, "host writes only partials");
            assert_eq!(v["sequence"], i as u64);
            assert_eq!(v["payload_kind"], "text_delta");
            joined.push_str(v["content"].as_str().unwrap());
        }
        assert_eq!(joined, "Hello, world");
    }

    #[test]
    fn partial_projection_is_a_noop_without_streams_dir() {
        let _guard = env_lock();
        std::env::remove_var("REFARM_STREAMS_DIR");
        // Must not panic and must write nothing when the dir is unset.
        append_partial_stream_ndjson(
            &meta("p-none"),
            &ModelStreamTextChunkDraft { sequence: 0, content_delta: "x".to_string() },
        );
    }

    #[test]
    fn host_is_sole_owner_partials_plus_empty_final_reconstruct_the_answer() {
        let _guard = env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("REFARM_STREAMS_DIR", dir.path());

        let m = meta("p-xyz");
        for (seq, delta) in [(0u32, "Olá "), (1, "stream")] {
            append_partial_stream_ndjson(
                &m,
                &ModelStreamTextChunkDraft { sequence: seq, content_delta: delta.to_string() },
            );
        }
        // The host writes the single final end-marker (guest skips its write when
        // partials were produced), sequence after the last partial.
        append_final_stream_ndjson(&m, 2);
        std::env::remove_var("REFARM_STREAMS_DIR");

        let path = dir
            .path()
            .join("urn:tractor:stream:response:p-xyz.ndjson");
        let body = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<serde_json::Value> = body
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();

        assert_eq!(lines.len(), 3, "two partials + one final");
        assert_eq!(
            lines.iter().filter(|l| l["is_final"] == true).count(),
            1,
            "exactly one final line"
        );
        let final_line = lines.iter().find(|l| l["is_final"] == true).unwrap();
        assert_eq!(final_line["content"], "", "final is an empty end-marker");
        assert_eq!(final_line["sequence"], 2);

        let reconstructed: String = lines
            .iter()
            .filter_map(|l| l["content"].as_str())
            .collect();
        assert_eq!(reconstructed, "Olá stream", "content += yields the answer once");
    }
}
