#![cfg_attr(not(test), allow(dead_code))]

/// Environment variable that opts into streaming partial AgentResponse nodes.
pub(crate) const MODEL_STREAM_RESPONSES_ENV: &str = "MODEL_STREAM_RESPONSES";

/// Streaming is ON by default. Missing, empty, or unrecognized values enable it;
/// only an explicit negative (`0`/`false`/`no`/`off`) opts OUT.
pub(crate) fn stream_responses_enabled_from_env() -> bool {
    let value = std::env::var(MODEL_STREAM_RESPONSES_ENV).ok();
    parse_stream_responses_flag(value.as_deref())
}

/// Default-on with an explicit opt-out set. The rule is stated as the negative
/// (return false only for the recognized opt-out values, trimmed+lowercased) so an
/// unrecognized spelling defaults to enabled rather than silently disabling
/// streaming — the safe direction now that incremental delivery is the norm.
pub(crate) fn parse_stream_responses_flag(value: Option<&str>) -> bool {
    !matches!(
        value.map(|v| v.trim().to_ascii_lowercase()),
        Some(v) if matches!(v.as_str(), "0" | "false" | "no" | "off")
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
