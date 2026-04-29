#[test]
fn parse_stream_text_deltas_from_sse_extracts_openai_delta_content() {
    let deltas = super::parse_stream_text_deltas_from_sse(
        br#"data: {"choices":[{"delta":{"content":"hel"}}]}

data: {"choices":[{"delta":{"content":"lo"}}]}

data: [DONE]

"#,
    );

    assert_eq!(deltas, vec!["hel".to_string(), "lo".to_string()]);
}

#[test]
fn parse_stream_text_deltas_from_sse_extracts_anthropic_content_block_delta() {
    let deltas = super::parse_stream_text_deltas_from_sse(
        br#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}

data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}

"#,
    );

    assert_eq!(deltas, vec!["hi".to_string()]);
}

#[test]
fn parse_stream_text_deltas_ignores_invalid_json_payloads() {
    let payloads = vec!["not json".to_string(), "{\"choices\":[]}".to_string()];

    let deltas = super::parse_stream_text_deltas(&payloads);

    assert!(deltas.is_empty());
}

#[test]
fn stream_text_chunk_drafts_from_sse_assigns_monotonic_sequences() {
    let chunks = super::stream_text_chunk_drafts_from_sse(
        br#"data: {"choices":[{"delta":{"content":"a"}}]}

data: {"choices":[{"delta":{"content":"b"}}]}

"#,
        Some(9),
    );

    assert_eq!(
        chunks,
        vec![
            super::LlmStreamTextChunkDraft {
                sequence: 10,
                content_delta: "a".to_string(),
            },
            super::LlmStreamTextChunkDraft {
                sequence: 11,
                content_delta: "b".to_string(),
            },
        ]
    );
    assert_eq!(super::last_stream_text_chunk_sequence(&chunks), Some(11));
}

#[test]
fn stream_text_chunk_drafts_from_sse_starts_at_zero_without_last_sequence() {
    let chunks = super::stream_text_chunk_drafts_from_sse(
        br#"data: {"type":"content_block_delta","delta":{"text":"x"}}

"#,
        None,
    );

    assert_eq!(chunks[0].sequence, 0);
    assert_eq!(super::last_stream_text_chunk_sequence(&[]), None);
}

#[test]
fn stream_agent_response_chunk_node_matches_partial_response_schema() {
    let metadata = stream_metadata(Some(4));
    let chunk = super::LlmStreamTextChunkDraft {
        sequence: 5,
        content_delta: "hello".to_string(),
    };

    let node = super::stream_agent_response_chunk_node("urn:test:resp:1", 123, &metadata, &chunk);

    assert_eq!(node["@type"], "AgentResponse");
    assert_eq!(node["@id"], "urn:test:resp:1");
    assert_eq!(node["prompt_ref"], "prompt-abc");
    assert_eq!(node["content"], "hello");
    assert_eq!(node["sequence"], 5);
    assert_eq!(node["is_final"], false);
    assert_eq!(node["tool_calls"], serde_json::json!([]));
    assert_eq!(node["timestamp_ns"], 123);
    assert_eq!(node["llm"]["model"], "gpt-4.1-mini");
    assert_eq!(node["llm"]["tokens_in"], 0);
    assert_eq!(node["llm"]["tokens_out"], 0);
    assert_eq!(node["llm"]["duration_ms"], 0);
}

#[test]
fn store_stream_agent_response_chunks_from_sse_persists_partial_nodes() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-chunks-test").unwrap();
    let metadata = stream_metadata(None);

    let (last_sequence, stored_chunks) = super::store_stream_agent_response_chunks_from_sse(
        &sync,
        "pi-agent",
        &metadata,
        br#"data: {"choices":[{"delta":{"content":"a"}}]}

data: {"choices":[{"delta":{"content":"b"}}]}

"#,
    )
    .unwrap();

    assert_eq!(last_sequence, Some(1));
    assert_eq!(stored_chunks, 2);
    let rows = sync.query_nodes("AgentResponse").unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|row| row.source_plugin.as_deref() == Some("pi-agent")));
    let payloads: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    assert_eq!(payloads[0]["sequence"], 0);
    assert_eq!(payloads[0]["content"], "a");
    assert_eq!(payloads[1]["sequence"], 1);
    assert_eq!(payloads[1]["content"], "b");
}

#[test]
fn store_stream_agent_response_chunks_from_sse_preserves_sequence_when_no_chunks() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-empty-test").unwrap();
    let metadata = stream_metadata(Some(7));

    let (last_sequence, stored_chunks) = super::store_stream_agent_response_chunks_from_sse(
        &sync,
        "pi-agent",
        &metadata,
        br#"{"message":"not sse"}"#,
    )
    .unwrap();

    assert_eq!(last_sequence, Some(7));
    assert_eq!(stored_chunks, 0);
    assert!(sync.query_nodes("AgentResponse").unwrap().is_empty());
}

#[test]
fn store_stream_agent_response_chunks_from_reader_persists_incrementally() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-reader-test").unwrap();
    let metadata = stream_metadata(Some(3));

    let (final_body, last_sequence, stored_chunks) =
        super::store_stream_agent_response_chunks_from_reader(
            &sync,
            "pi-agent",
            &metadata,
            std::io::Cursor::new(
                br#"data: {"choices":[{"delta":{"content":"a"}}]}

data: {"choices":[{"delta":{"content":"b"}}]}

"#,
            ),
            1024,
        )
        .unwrap();

    let final_json: serde_json::Value = serde_json::from_slice(&final_body).unwrap();
    assert_eq!(final_json["choices"][0]["message"]["content"], "ab");
    assert_eq!(final_json["usage"]["total_tokens"], 0);
    assert_eq!(last_sequence, Some(5));
    assert_eq!(stored_chunks, 2);
    let rows = sync.query_nodes("AgentResponse").unwrap();
    let payloads: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    assert_eq!(payloads[0]["sequence"], 4);
    assert_eq!(payloads[1]["sequence"], 5);
}

#[test]
fn synthesize_stream_final_response_body_emits_anthropic_shape() {
    let mut metadata = stream_metadata(None);
    metadata.provider_family = "anthropic".to_string();

    let mut assembly = super::LlmStreamFinalAssembly::default();
    assembly.content = "hello".to_string();

    let body = super::synthesize_stream_final_response_body(&metadata, &assembly).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["content"][0]["type"], "text");
    assert_eq!(json["content"][0]["text"], "hello");
    assert_eq!(json["usage"]["input_tokens"], 0);
    assert_eq!(json["usage"]["output_tokens"], 0);
}

#[test]
fn store_stream_agent_response_chunks_from_reader_synthesizes_openai_tool_calls() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-reader-openai-tools-test").unwrap();
    let metadata = stream_metadata(None);

    let (final_body, last_sequence, stored_chunks) =
        super::store_stream_agent_response_chunks_from_reader(
            &sync,
            "pi-agent",
            &metadata,
            std::io::Cursor::new(
                br#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_structured","arguments":"{\"path\":"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"package.json\"}"}}]}}]}

"#,
            ),
            2048,
        )
        .unwrap();

    assert_eq!(stored_chunks, 0);
    assert_eq!(last_sequence, None);
    assert!(sync.query_nodes("AgentResponse").unwrap().is_empty());
    let json: serde_json::Value = serde_json::from_slice(&final_body).unwrap();
    let tool_call = &json["choices"][0]["message"]["tool_calls"][0];
    assert_eq!(tool_call["id"], "call_1");
    assert_eq!(tool_call["function"]["name"], "read_structured");
    assert_eq!(
        tool_call["function"]["arguments"],
        "{\"path\":\"package.json\"}"
    );
}

#[test]
fn store_stream_agent_response_chunks_from_reader_synthesizes_anthropic_tool_uses() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-reader-anthropic-tools-test").unwrap();
    let mut metadata = stream_metadata(None);
    metadata.provider_family = "anthropic".to_string();

    let (final_body, last_sequence, stored_chunks) =
        super::store_stream_agent_response_chunks_from_reader(
            &sync,
            "pi-agent",
            &metadata,
            std::io::Cursor::new(
                br#"data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_structured","input":{}}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"package.json\"}"}}

"#,
            ),
            2048,
        )
        .unwrap();

    assert_eq!(stored_chunks, 0);
    assert_eq!(last_sequence, None);
    assert!(sync.query_nodes("AgentResponse").unwrap().is_empty());
    let json: serde_json::Value = serde_json::from_slice(&final_body).unwrap();
    let tool_use = &json["content"][0];
    assert_eq!(tool_use["type"], "tool_use");
    assert_eq!(tool_use["id"], "toolu_1");
    assert_eq!(tool_use["name"], "read_structured");
    assert_eq!(tool_use["input"]["path"], "package.json");
}

#[test]
fn store_stream_agent_response_chunks_from_reader_enforces_body_limit() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-reader-limit-test").unwrap();
    let metadata = stream_metadata(None);

    let err = super::store_stream_agent_response_chunks_from_reader(
        &sync,
        "pi-agent",
        &metadata,
        std::io::Cursor::new(br#"data: {"choices":[]}\n\n"#),
        4,
    )
    .unwrap_err();

    assert!(err.contains("too large"));
    assert!(sync.query_nodes("AgentResponse").unwrap().is_empty());
}

fn stream_metadata(last_sequence: Option<u32>) -> super::StreamResponseMetadata {
    super::StreamResponseMetadata {
        prompt_ref: "prompt-abc".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "openai".to_string(),
        last_sequence,
    }
}
