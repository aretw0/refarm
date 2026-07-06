use crate::streaming_config::{
    parse_stream_responses_flag, provider_stream_request_enabled,
    provider_stream_request_enabled_from_env, stream_responses_enabled_from_env,
    streaming_reader_available,
};

#[test]
fn streaming_config_defaults_to_enabled() {
    // Streaming is ON by default: incremental token delivery is the norm.
    std::env::remove_var("MODEL_STREAM_RESPONSES");
    assert!(stream_responses_enabled_from_env());
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
fn streaming_config_enables_missing_empty_and_unknown_values() {
    // Default-on: only the explicit opt-out set disables. Anything else — missing,
    // empty, or an unrecognized spelling like "stream" — enables, so a typo never
    // silently turns streaming off.
    for value in [None, Some(""), Some("stream"), Some("maybe"), Some("1")] {
        assert!(
            parse_stream_responses_flag(value),
            "value should enable streaming (default-on): {value:?}"
        );
    }
}

#[test]
fn streaming_config_disables_only_on_explicit_opt_out() {
    for value in ["0", "false", "FALSE", "no", "off", " off "] {
        assert!(
            !parse_stream_responses_flag(Some(value)),
            "value should opt OUT of streaming: {value}"
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
fn streaming_config_enables_provider_streaming_by_default_and_honors_opt_out() {
    assert!(streaming_reader_available());

    // Default-on: provider streaming is requested with no env set.
    std::env::remove_var("MODEL_STREAM_RESPONSES");
    assert!(provider_stream_request_enabled_from_env());

    // Explicit opt-out turns it off.
    std::env::set_var("MODEL_STREAM_RESPONSES", "0");
    assert!(!provider_stream_request_enabled_from_env());
    std::env::remove_var("MODEL_STREAM_RESPONSES");
}
