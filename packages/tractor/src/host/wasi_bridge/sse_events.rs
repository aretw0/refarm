/// Incremental Server-Sent Events `data:` payload buffer.
///
/// This is provider-neutral and target-neutral: callers push arbitrary byte
/// chunks and receive complete SSE `data:` payloads once frame boundaries are
/// observed. Protocol-specific JSON interpretation belongs in higher layers.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Default)]
struct SseDataEventBuffer {
    buffer: String,
}

#[cfg_attr(not(test), allow(dead_code))]
impl SseDataEventBuffer {
    fn push_bytes(&mut self, bytes: &[u8]) -> Vec<String> {
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

    fn finish(&mut self) -> Vec<String> {
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
#[cfg_attr(not(test), allow(dead_code))]
fn parse_sse_data_events(bytes: &[u8]) -> Vec<String> {
    let mut buffer = SseDataEventBuffer::default();
    let mut events = buffer.push_bytes(bytes);
    events.extend(buffer.finish());
    events
}

#[cfg_attr(not(test), allow(dead_code))]
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

#[cfg_attr(not(test), allow(dead_code))]
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
