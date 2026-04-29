#![cfg_attr(not(test), allow(dead_code))]

/// Streaming chunks use monotonically increasing sequence numbers per prompt.
pub(crate) fn first_response_sequence() -> u32 {
    0
}

pub(crate) fn next_response_sequence(previous: u32) -> u32 {
    previous.saturating_add(1)
}

/// Final responses use the first sequence when no partial chunk was emitted.
/// If streaming has already emitted partial chunks, the final response follows
/// the last partial sequence.
pub(crate) fn final_response_sequence(
    streaming_enabled: bool,
    last_partial_sequence: Option<u32>,
) -> u32 {
    if streaming_enabled {
        last_partial_sequence
            .map(next_response_sequence)
            .unwrap_or_else(first_response_sequence)
    } else {
        first_response_sequence()
    }
}

/// Partial chunks are CRDT-visible observations, but only final responses enter
/// the conversational session history consumed by future prompts.
pub(crate) fn should_append_response_chunk_to_session(is_final: bool) -> bool {
    is_final
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResponseChunkDraft {
    pub content: String,
    pub sequence: u32,
    pub is_final: bool,
}

/// Convert provider text deltas into partial response chunk drafts.
///
/// The drafts intentionally carry only streaming-neutral metadata; the runtime
/// persistence layer adds model, token, timing, and tool-call fields when the
/// chunks are stored as AgentResponse nodes.
pub(crate) fn partial_response_chunk_drafts(
    deltas: &[String],
    last_sequence: Option<u32>,
) -> Vec<ResponseChunkDraft> {
    let mut next_sequence = last_sequence
        .map(next_response_sequence)
        .unwrap_or_else(first_response_sequence);

    deltas
        .iter()
        .filter(|delta| !delta.is_empty())
        .map(|delta| {
            let chunk = ResponseChunkDraft {
                content: delta.clone(),
                sequence: next_sequence,
                is_final: false,
            };
            next_sequence = next_response_sequence(next_sequence);
            chunk
        })
        .collect()
}
