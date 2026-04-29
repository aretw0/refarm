#![cfg_attr(not(test), allow(dead_code))]

/// Extract `data:` payloads from a server-sent events byte stream.
///
/// This intentionally stays provider-neutral: OpenAI-compatible and Anthropic
/// streaming responses both use SSE framing, while their JSON payload schemas
/// differ. `[DONE]` sentinels and comments are omitted.
pub(crate) fn parse_sse_data_events(bytes: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    text.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .filter(|payload| !payload.is_empty() && *payload != "[DONE]")
        .map(str::to_string)
        .collect()
}
