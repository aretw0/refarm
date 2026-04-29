#![cfg_attr(not(test), allow(dead_code))]

/// Environment variable that opts into streaming partial AgentResponse nodes.
pub(crate) const LLM_STREAM_RESPONSES_ENV: &str = "LLM_STREAM_RESPONSES";

/// Streaming is explicitly opt-in. Missing, empty, or unrecognized values are false.
pub(crate) fn stream_responses_enabled_from_env() -> bool {
    let value = std::env::var(LLM_STREAM_RESPONSES_ENV).ok();
    parse_stream_responses_flag(value.as_deref())
}

pub(crate) fn parse_stream_responses_flag(value: Option<&str>) -> bool {
    matches!(
        value.map(|v| v.trim().to_ascii_lowercase()),
        Some(v) if matches!(v.as_str(), "1" | "true" | "yes" | "on")
    )
}

/// Request provider-level streaming only when both policy and transport support it.
///
/// This keeps provider streaming explicitly opt-in while the host owns transport,
/// route enforcement, credentials, partial chunk persistence, and final response
/// compatibility for provider SSE bodies.
pub(crate) fn provider_stream_request_enabled(
    stream_responses_enabled: bool,
    streaming_reader_available: bool,
) -> bool {
    stream_responses_enabled && streaming_reader_available
}

/// Transport readiness flag for provider streaming.
///
/// The guest still performs an explicit opt-in check, but provider SSE transport
/// is now host-proxied: Tractor reads the response body, persists partial chunks,
/// and returns parser-compatible final JSON to the plugin.
pub(crate) fn streaming_reader_available() -> bool {
    true
}

pub(crate) fn provider_stream_request_enabled_from_env() -> bool {
    provider_stream_request_enabled(
        stream_responses_enabled_from_env(),
        streaming_reader_available(),
    )
}
