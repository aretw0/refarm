#![cfg_attr(not(test), allow(dead_code))]

/// Streaming chunks use monotonically increasing sequence numbers per prompt.
pub(crate) fn first_response_sequence() -> u32 {
    0
}

pub(crate) fn next_response_sequence(previous: u32) -> u32 {
    previous.saturating_add(1)
}

/// Partial chunks are CRDT-visible observations, but only final responses enter
/// the conversational session history consumed by future prompts.
pub(crate) fn should_append_response_chunk_to_session(is_final: bool) -> bool {
    is_final
}
