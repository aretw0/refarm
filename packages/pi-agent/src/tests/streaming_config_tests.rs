use crate::streaming_config::{
    parse_stream_responses_flag, provider_stream_request_enabled,
    provider_stream_request_enabled_from_env, stream_responses_enabled_from_env,
    streaming_reader_available,
};

#[test]
fn streaming_config_defaults_to_disabled() {
    std::env::remove_var("LLM_STREAM_RESPONSES");
    assert!(!stream_responses_enabled_from_env());
}

#[test]
fn streaming_config_accepts_explicit_truthy_values() {
    for value in ["1", "true", "TRUE", "yes", "on", " on "] {
        assert!(
            parse_stream_responses_flag(Some(value)),
            "value should enable streaming: {value}"
        );
    }
}

#[test]
fn streaming_config_rejects_missing_empty_and_unknown_values() {
    for value in [
        None,
        Some(""),
        Some("0"),
        Some("false"),
        Some("no"),
        Some("stream"),
    ] {
        assert!(
            !parse_stream_responses_flag(value),
            "value should not enable streaming: {value:?}"
        );
    }
}

#[test]
fn streaming_config_requires_transport_support_before_provider_stream_flag() {
    assert!(!provider_stream_request_enabled(false, false));
    assert!(!provider_stream_request_enabled(true, false));
    assert!(!provider_stream_request_enabled(false, true));
    assert!(provider_stream_request_enabled(true, true));
}

#[test]
fn streaming_config_enables_provider_streaming_only_when_opted_in() {
    assert!(streaming_reader_available());

    std::env::remove_var("LLM_STREAM_RESPONSES");
    assert!(!provider_stream_request_enabled_from_env());

    std::env::set_var("LLM_STREAM_RESPONSES", "1");
    assert!(provider_stream_request_enabled_from_env());
    std::env::remove_var("LLM_STREAM_RESPONSES");
}
