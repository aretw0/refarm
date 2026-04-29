/// Incremental Server-Sent Events `data:` payload buffer.
///
/// This is provider-neutral and target-neutral: callers push arbitrary byte
/// chunks and receive complete SSE `data:` payloads once frame boundaries are
/// observed. Protocol-specific JSON interpretation belongs in higher layers.
#[derive(Debug, Default)]
pub(crate) struct SseDataEventBuffer {
    buffer: String,
}

impl SseDataEventBuffer {
    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        self.buffer = self.buffer.replace("\r\n", "\n");

        let mut events = Vec::new();
        while let Some(event_end) = self.buffer.find("\n\n") {
            let mut frame = self.buffer.drain(..event_end + 2).collect::<String>();
            frame.truncate(event_end);
            push_sse_event_frame_payload(&mut events, &frame);
        }
        events
    }

    pub(crate) fn finish(&mut self) -> Vec<String> {
        let frame = std::mem::take(&mut self.buffer);
        let mut events = Vec::new();
        push_sse_event_frame_payload(&mut events, &frame);
        events
    }
}

/// Extract provider-neutral `data:` payloads from a Server-Sent Events byte stream.
///
/// `[DONE]` is treated as a stream sentinel and dropped. Comments and non-data
/// fields are ignored; multiline data frames are joined with `\n`.
pub(crate) fn parse_sse_data_events(bytes: &[u8]) -> Vec<String> {
    let mut buffer = SseDataEventBuffer::default();
    let mut events = buffer.push_bytes(bytes);
    events.extend(buffer.finish());
    events
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn read_sse_data_events_limited(
    reader: impl std::io::Read,
    max_len: usize,
    on_data_event: impl FnMut(&str) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    read_sse_data_events_limited_with_chunk_size(reader, max_len, 8 * 1024, on_data_event)
}

#[cfg_attr(not(test), allow(dead_code))]
fn read_sse_data_events_limited_with_chunk_size(
    mut reader: impl std::io::Read,
    max_len: usize,
    chunk_size: usize,
    mut on_data_event: impl FnMut(&str) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buffer = SseDataEventBuffer::default();
    let mut chunk = vec![0u8; chunk_size.max(1)];

    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|e| format!("sse stream read: {e}"))?;
        if read == 0 {
            break;
        }
        out.extend_from_slice(&chunk[..read]);
        if out.len() > max_len {
            return Err("sse stream body too large".to_string());
        }
        for event in buffer.push_bytes(&chunk[..read]) {
            on_data_event(&event)?;
        }
    }

    for event in buffer.finish() {
        on_data_event(&event)?;
    }

    Ok(out)
}

fn push_sse_event_frame_payload(events: &mut Vec<String>, frame: &str) {
    let mut current_data_lines = Vec::new();
    for line in frame.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.starts_with(':') {
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            current_data_lines.push(data.trim_start().to_string());
        }
    }
    push_sse_event_data(events, &mut current_data_lines);
}

fn push_sse_event_data(events: &mut Vec<String>, current_data_lines: &mut Vec<String>) {
    if current_data_lines.is_empty() {
        return;
    }

    let payload = current_data_lines.join("\n").trim().to_string();
    current_data_lines.clear();
    if !payload.is_empty() && payload != "[DONE]" {
        events.push(payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_data_events_extracts_payloads_and_drops_done() {
        let events = parse_sse_data_events(
            b": keep-alive\n\
              data: {\"delta\":\"hello\"}\n\n\
              data: [DONE]\n\n",
        );

        assert_eq!(events, vec!["{\"delta\":\"hello\"}".to_string()]);
    }

    #[test]
    fn parse_sse_data_events_handles_crlf_and_multiline_data() {
        let events =
            parse_sse_data_events(b"data: first\r\ndata: second\r\n\r\ndata: third\r\n\r\n");

        assert_eq!(
            events,
            vec!["first\nsecond".to_string(), "third".to_string()]
        );
    }

    #[test]
    fn parse_sse_data_events_flushes_trailing_event_without_blank_line() {
        let events = parse_sse_data_events(b"event: ignored\ndata: trailing");

        assert_eq!(events, vec!["trailing".to_string()]);
    }

    #[test]
    fn sse_data_event_buffer_emits_only_complete_frames_until_finish() {
        let mut buffer = SseDataEventBuffer::default();

        assert!(buffer.push_bytes(b"data: fir").is_empty());
        assert_eq!(buffer.push_bytes(b"st\n\n"), vec!["first".to_string()]);
        assert!(buffer.push_bytes(b"data: trailing").is_empty());
        assert_eq!(buffer.finish(), vec!["trailing".to_string()]);
    }

    #[test]
    fn sse_data_event_buffer_handles_crlf_split_across_chunks() {
        let mut buffer = SseDataEventBuffer::default();

        assert!(buffer.push_bytes(b"data: one\r").is_empty());
        assert_eq!(buffer.push_bytes(b"\n\r\n"), vec!["one".to_string()]);
    }

    #[test]
    fn read_sse_data_events_limited_streams_events_and_returns_body() {
        let mut wrapper_events = Vec::new();
        read_sse_data_events_limited(std::io::Cursor::new(b"data: wrapper\n\n"), 1024, |event| {
            wrapper_events.push(event.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(wrapper_events, vec!["wrapper".to_string()]);

        let mut events = Vec::new();
        let body = read_sse_data_events_limited_with_chunk_size(
            std::io::Cursor::new(b"data: first\n\ndata: second"),
            1024,
            4,
            |event| {
                events.push(event.to_string());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(body, b"data: first\n\ndata: second");
        assert_eq!(events, vec!["first".to_string(), "second".to_string()]);
    }

    #[test]
    fn read_sse_data_events_limited_enforces_body_limit() {
        let err = read_sse_data_events_limited_with_chunk_size(
            std::io::Cursor::new(b"data: too-large\n\n"),
            4,
            4,
            |_| Ok(()),
        )
        .unwrap_err();

        assert!(err.contains("too large"));
    }

    #[test]
    fn read_sse_data_events_limited_propagates_event_errors() {
        let err = read_sse_data_events_limited_with_chunk_size(
            std::io::Cursor::new(b"data: first\n\n"),
            1024,
            4,
            |_| Err("stop".to_string()),
        )
        .unwrap_err();

        assert_eq!(err, "stop");
    }
}
