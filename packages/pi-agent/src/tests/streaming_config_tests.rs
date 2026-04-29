use crate::streaming_config::{parse_stream_responses_flag, stream_responses_enabled_from_env};

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
