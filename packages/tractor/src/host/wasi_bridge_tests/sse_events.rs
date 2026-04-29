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
fn sse_data_event_buffer_emits_only_complete_frames_until_finish() {
    let mut buffer = super::SseDataEventBuffer::default();

    assert!(buffer.push_bytes(b"data: fir").is_empty());
    assert_eq!(buffer.push_bytes(b"st\n\n"), vec!["first".to_string()]);
    assert!(buffer.push_bytes(b"data: trailing").is_empty());
    assert_eq!(buffer.finish(), vec!["trailing".to_string()]);
}

#[test]
fn sse_data_event_buffer_handles_crlf_split_across_chunks() {
    let mut buffer = super::SseDataEventBuffer::default();

    assert!(buffer.push_bytes(b"data: one\r").is_empty());
    assert_eq!(buffer.push_bytes(b"\n\r\n"), vec!["one".to_string()]);
}
