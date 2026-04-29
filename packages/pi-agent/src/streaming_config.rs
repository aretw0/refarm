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
