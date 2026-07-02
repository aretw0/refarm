use crate::runtime::streaming_sink::StreamResponseSinkState;

#[test]
fn streaming_sink_state_starts_without_partial_sequence() {
    let sink = StreamResponseSinkState::new("prompt-1", "model-a");

    assert_eq!(sink.prompt_ref(), "prompt-1");
    assert_eq!(sink.model(), "model-a");
    assert_eq!(sink.last_sequence(), None);
}

#[test]
fn streaming_sink_state_updates_model_without_resetting_sequence() {
    let mut sink = StreamResponseSinkState::new("prompt-1", "primary-model");
    sink.update_last_sequence(Some(3));

    sink.update_model("fallback-model");

    assert_eq!(sink.model(), "fallback-model");
    assert_eq!(sink.last_sequence(), Some(3));
}

#[test]
fn streaming_sink_state_ignores_missing_sequence_updates() {
    let mut sink = StreamResponseSinkState::new("prompt-1", "model-a");
    sink.update_last_sequence(Some(4));

    sink.update_last_sequence(None);

    assert_eq!(sink.last_sequence(), Some(4));
}
