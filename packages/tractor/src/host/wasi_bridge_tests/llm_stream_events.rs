#[test]
fn parse_sse_data_events_extracts_payloads_and_drops_done() {
    let events = super::parse_sse_data_events(
        b": keep-alive\n\
          data: {\"delta\":\"hello\"}\n\n\
          data: [DONE]\n\n",
    );

    assert_eq!(events, vec!["{\"delta\":\"hello\"}".to_string()]);
}

#[test]
fn parse_sse_data_events_handles_crlf_and_multiline_data() {
    let events =
        super::parse_sse_data_events(b"data: first\r\ndata: second\r\n\r\ndata: third\r\n\r\n");

    assert_eq!(
        events,
        vec!["first\nsecond".to_string(), "third".to_string()]
    );
}

#[test]
fn parse_sse_data_events_flushes_trailing_event_without_blank_line() {
    let events = super::parse_sse_data_events(b"event: ignored\ndata: trailing");

    assert_eq!(events, vec!["trailing".to_string()]);
}

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

fn stream_metadata(last_sequence: Option<u32>) -> super::StreamResponseMetadata {
    super::StreamResponseMetadata {
        prompt_ref: "prompt-abc".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "openai".to_string(),
        last_sequence,
    }
}
