#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveStreamResponseSink {
    prompt_ref: String,
    model: String,
    last_sequence: Option<u32>,
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static ACTIVE_STREAM_RESPONSE_SINK: std::cell::RefCell<Option<ActiveStreamResponseSink>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn set_active_stream_response_sink(prompt_ref: &str, model: &str) {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        *sink.borrow_mut() = Some(ActiveStreamResponseSink {
            prompt_ref: prompt_ref.to_owned(),
            model: model.to_owned(),
            last_sequence: None,
        });
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn record_stream_bytes_for_active_sink(bytes: &[u8]) {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        let mut sink = sink.borrow_mut();
        let Some(active) = sink.as_mut() else {
            return;
        };

        let defaults = super::prompt_persistence::AgentResponseChunkDefaults {
            model: active.model.clone(),
            tokens_in: 0,
            tokens_out: 0,
            duration_ms: 0,
        };
        let (last_sequence, _stored) =
            super::prompt_persistence::store_agent_response_chunks_from_sse(
                &active.prompt_ref,
                bytes,
                active.last_sequence,
                defaults,
            );
        if last_sequence.is_some() {
            active.last_sequence = last_sequence;
        }
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn take_active_stream_last_sequence() -> Option<u32> {
    ACTIVE_STREAM_RESPONSE_SINK
        .with(|sink| sink.borrow_mut().take().and_then(|sink| sink.last_sequence))
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn take_active_stream_last_sequence() -> Option<u32> {
    None
}
