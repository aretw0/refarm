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
fn stream_chunk_observation_draft_matches_generic_projection_schema() {
    let metadata = stream_metadata(Some(4));
    let chunk = super::LlmStreamTextChunkDraft {
        sequence: 5,
        content_delta: "hello".to_string(),
    };

    let draft = super::stream_chunk_observation_draft(&metadata, &chunk, 123);
    let node = crate::streaming::stream_chunk_observation_node("urn:test:chunk:1", &draft);

    assert_eq!(node["@type"], "StreamChunk");
    assert_eq!(
        node["stream_ref"],
        "urn:tractor:stream:agent-response:prompt-abc"
    );
    assert_eq!(node["sequence"], 5);
    assert_eq!(node["payload_kind"], "text_delta");
    assert_eq!(node["content"], "hello");
    assert_eq!(node["is_final"], false);
    assert_eq!(node["timestamp_ns"], 123);
    assert_eq!(node["metadata"]["projection"], "AgentResponse");
    assert_eq!(node["metadata"]["provider_family"], "openai");
    assert_eq!(node["metadata"]["model"], "gpt-4.1-mini");
}

#[test]
fn stream_session_observation_draft_matches_generic_session_schema() {
    let metadata = stream_metadata(Some(4));

    let draft = super::stream_session_observation_draft(
        &metadata,
        "completed",
        100,
        200,
        Some(200),
        Some(6),
        3,
    );
    let node_id = crate::streaming::stream_session_observation_id(&draft.stream_ref);
    let node = crate::streaming::stream_session_observation_node(&node_id, &draft);

    assert_eq!(node["@type"], "StreamSession");
    assert_eq!(node["@id"], "urn:tractor:stream:agent-response:prompt-abc");
    assert_eq!(node["stream_kind"], "agent-response");
    assert_eq!(node["status"], "completed");
    assert_eq!(node["started_at_ns"], 100);
    assert_eq!(node["updated_at_ns"], 200);
    assert_eq!(node["completed_at_ns"], 200);
    assert_eq!(node["last_sequence"], 6);
    assert_eq!(node["chunk_count"], 3);
    assert_eq!(node["metadata"]["projection"], "AgentResponse");
    assert_eq!(node["metadata"]["prompt_ref"], "prompt-abc");
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

    let stream_rows = sync.query_nodes("StreamChunk").unwrap();
    assert_eq!(stream_rows.len(), 2);
    assert!(stream_rows
        .iter()
        .all(|row| row.source_plugin.as_deref() == Some("pi-agent")));
    let stream_payloads: Vec<serde_json::Value> = stream_rows
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    assert_eq!(
        stream_payloads[0]["stream_ref"],
        "urn:tractor:stream:agent-response:prompt-abc"
    );
    assert_eq!(stream_payloads[0]["sequence"], 0);
    assert_eq!(stream_payloads[0]["payload_kind"], "text_delta");
    assert_eq!(stream_payloads[0]["content"], "a");
    assert_eq!(stream_payloads[1]["sequence"], 1);
    assert_eq!(stream_payloads[1]["content"], "b");
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
    assert!(sync.query_nodes("StreamChunk").unwrap().is_empty());
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

    let stream_rows = sync.query_nodes("StreamChunk").unwrap();
    assert_eq!(stream_rows.len(), 3, "two partial chunks plus final marker");
    let stream_payloads: Vec<serde_json::Value> = stream_rows
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    assert_eq!(stream_payloads[0]["sequence"], 4);
    assert_eq!(stream_payloads[0]["is_final"], false);
    assert_eq!(stream_payloads[1]["sequence"], 5);
    assert_eq!(stream_payloads[1]["is_final"], false);
    assert_eq!(stream_payloads[2]["sequence"], 6);
    assert_eq!(stream_payloads[2]["payload_kind"], "final_text");
    assert_eq!(stream_payloads[2]["content"], "ab");
    assert_eq!(stream_payloads[2]["is_final"], true);

    let session_rows = sync.query_nodes("StreamSession").unwrap();
    assert_eq!(session_rows.len(), 1);
    assert_eq!(session_rows[0].source_plugin.as_deref(), Some("pi-agent"));
    let session: serde_json::Value = serde_json::from_str(&session_rows[0].payload).unwrap();
    assert_eq!(
        session["@id"],
        "urn:tractor:stream:agent-response:prompt-abc"
    );
    assert_eq!(
        session["stream_ref"],
        "urn:tractor:stream:agent-response:prompt-abc"
    );
    assert_eq!(session["stream_kind"], "agent-response");
    assert_eq!(session["status"], "completed");
    assert_eq!(session["last_sequence"], 6);
    assert_eq!(session["chunk_count"], 3);
    assert_eq!(session["metadata"]["projection"], "AgentResponse");
}

#[test]
fn store_stream_agent_response_chunks_from_reader_preserves_openai_usage() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "stream-reader-openai-usage-test").unwrap();
    let metadata = stream_metadata(None);

    let (final_body, last_sequence, stored_chunks) =
        super::store_stream_agent_response_chunks_from_reader(
            &sync,
            "pi-agent",
            &metadata,
            std::io::Cursor::new(
                br#"data: {"choices":[{"delta":{"content":"a"}}]}

data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}

"#,
            ),
            2048,
        )
        .unwrap();

    let final_json: serde_json::Value = serde_json::from_slice(&final_body).unwrap();
    assert_eq!(final_json["choices"][0]["message"]["content"], "a");
    assert_eq!(final_json["usage"]["prompt_tokens"], 7);
    assert_eq!(final_json["usage"]["completion_tokens"], 3);
    assert_eq!(final_json["usage"]["total_tokens"], 10);
    assert_eq!(last_sequence, Some(0));
    assert_eq!(stored_chunks, 1);
}

#[test]
fn final_stream_sequence_follows_partial_or_initial_sequence() {
    assert_eq!(super::final_stream_sequence(None, None), 0);
    assert_eq!(super::final_stream_sequence(Some(7), None), 8);
    assert_eq!(super::final_stream_sequence(Some(7), Some(9)), 10);
    assert_eq!(super::final_stream_sequence(None, Some(u32::MAX)), u32::MAX);
}

#[test]
fn final_stream_payload_kind_describes_terminal_observation() {
    let text = super::LlmStreamFinalAssembly {
        content: "hello".to_string(),
        ..Default::default()
    };
    let tool_call = super::LlmStreamFinalAssembly {
        openai_tool_calls: vec![super::OpenAiStreamToolCall::default()],
        ..Default::default()
    };
    let usage_only = super::LlmStreamFinalAssembly {
        usage: super::LlmStreamUsage {
            total_tokens: Some(1),
            ..Default::default()
        },
        ..Default::default()
    };

    assert_eq!(super::final_stream_payload_kind(&text), "final_text");
    assert_eq!(
        super::final_stream_payload_kind(&tool_call),
        "final_tool_call"
    );
    assert_eq!(super::final_stream_payload_kind(&usage_only), "final_empty");
}

#[test]
fn synthesize_stream_final_response_body_emits_anthropic_shape() {
    let mut metadata = stream_metadata(None);
    metadata.provider_family = "anthropic".to_string();

    let assembly = super::LlmStreamFinalAssembly {
        content: "hello".to_string(),
        usage: super::LlmStreamUsage {
            input_tokens: Some(11),
            output_tokens: Some(5),
            ..Default::default()
        },
        ..Default::default()
    };

    let body = super::synthesize_stream_final_response_body(&metadata, &assembly).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["content"][0]["type"], "text");
    assert_eq!(json["content"][0]["text"], "hello");
    assert_eq!(json["usage"]["input_tokens"], 11);
    assert_eq!(json["usage"]["output_tokens"], 5);
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
    let stream_rows = sync.query_nodes("StreamChunk").unwrap();
    assert_eq!(stream_rows.len(), 1);
    let stream_chunk: serde_json::Value = serde_json::from_str(&stream_rows[0].payload).unwrap();
    assert_eq!(stream_chunk["payload_kind"], "final_tool_call");
    assert_eq!(stream_chunk["is_final"], true);
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

    let session_rows = sync.query_nodes("StreamSession").unwrap();
    assert_eq!(session_rows.len(), 1);
    let session: serde_json::Value = serde_json::from_str(&session_rows[0].payload).unwrap();
    assert_eq!(session["status"], "failed");
    assert_eq!(session["last_sequence"], serde_json::Value::Null);
    assert_eq!(session["chunk_count"], 0);
    assert_eq!(session["metadata"]["failure_kind"], "stream_read_failed");
    assert!(session["metadata"]["failure_reason"]
        .as_str()
        .unwrap()
        .contains("too large"));
}

fn stream_metadata(last_sequence: Option<u32>) -> super::StreamResponseMetadata {
    super::StreamResponseMetadata {
        prompt_ref: "prompt-abc".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "openai".to_string(),
        last_sequence,
    }
}
