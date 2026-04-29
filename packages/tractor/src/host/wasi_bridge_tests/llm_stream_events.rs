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
fn stream_text_chunk_drafts_from_sse_starts_at_one_without_last_sequence() {
    let chunks = super::stream_text_chunk_drafts_from_sse(
        br#"data: {"type":"content_block_delta","delta":{"text":"x"}}

"#,
        None,
    );

    assert_eq!(chunks[0].sequence, 1);
    assert_eq!(super::last_stream_text_chunk_sequence(&[]), None);
}
