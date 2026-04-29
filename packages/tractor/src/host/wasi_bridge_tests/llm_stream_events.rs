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
