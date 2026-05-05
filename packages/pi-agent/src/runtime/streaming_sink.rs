#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

#[cfg(any(test, target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamResponseSinkState {
    prompt_ref: String,
    model: String,
    last_sequence: Option<u32>,
}

#[cfg(any(test, target_arch = "wasm32"))]
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
impl StreamResponseSinkState {
    pub(crate) fn new(prompt_ref: &str, model: &str) -> Self {
        Self {
            prompt_ref: prompt_ref.to_owned(),
            model: model.to_owned(),
            last_sequence: None,
        }
    }

    pub(crate) fn prompt_ref(&self) -> &str {
        &self.prompt_ref
    }

    pub(crate) fn model(&self) -> &str {
        &self.model
    }

    pub(crate) fn last_sequence(&self) -> Option<u32> {
        self.last_sequence
    }

    pub(crate) fn update_model(&mut self, model: &str) {
        self.model = model.to_owned();
    }

    pub(crate) fn update_last_sequence(&mut self, last_sequence: Option<u32>) {
        if last_sequence.is_some() {
            self.last_sequence = last_sequence;
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActiveStreamResponseMetadata {
    pub prompt_ref: String,
    pub model: String,
    pub last_sequence: Option<u32>,
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static ACTIVE_STREAM_RESPONSE_SINK: std::cell::RefCell<Option<StreamResponseSinkState>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn set_active_stream_response_sink(prompt_ref: &str, model: &str) {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        *sink.borrow_mut() = Some(StreamResponseSinkState::new(prompt_ref, model));
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn update_active_stream_response_sink_model(model: &str) {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        if let Some(active) = sink.borrow_mut().as_mut() {
            active.update_model(model);
        }
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn active_stream_response_metadata() -> Option<ActiveStreamResponseMetadata> {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        sink.borrow()
            .as_ref()
            .map(|active| ActiveStreamResponseMetadata {
                prompt_ref: active.prompt_ref().to_owned(),
                model: active.model().to_owned(),
                last_sequence: active.last_sequence(),
            })
    })
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn record_host_stream_result_for_active_sink(last_sequence: Option<u32>) {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        if let Some(active) = sink.borrow_mut().as_mut() {
            active.update_last_sequence(last_sequence);
        }
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
                active.last_sequence(),
                defaults,
            );
        active.update_last_sequence(last_sequence);
    });
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn take_active_stream_last_sequence() -> Option<u32> {
    ACTIVE_STREAM_RESPONSE_SINK.with(|sink| {
        sink.borrow_mut()
            .take()
            .and_then(|sink| sink.last_sequence())
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn take_active_stream_last_sequence() -> Option<u32> {
    None
}
