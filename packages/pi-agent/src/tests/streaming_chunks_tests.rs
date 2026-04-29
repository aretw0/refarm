use crate::streaming_chunks::{
    final_response_sequence, first_response_sequence, last_response_chunk_sequence,
    next_response_sequence, partial_response_chunk_drafts, should_append_response_chunk_to_session,
    ResponseChunkDraft,
};

#[test]
fn streaming_chunks_start_at_zero() {
    assert_eq!(first_response_sequence(), 0);
}

#[test]
fn streaming_chunks_advance_monotonically_and_saturate() {
    assert_eq!(next_response_sequence(0), 1);
    assert_eq!(next_response_sequence(41), 42);
    assert_eq!(next_response_sequence(u32::MAX), u32::MAX);
}

#[test]
fn streaming_chunks_only_append_final_chunks_to_session_history() {
    assert!(!should_append_response_chunk_to_session(false));
    assert!(should_append_response_chunk_to_session(true));
}

#[test]
fn final_response_sequence_follows_partial_chunks_only_when_streaming_is_enabled() {
    assert_eq!(final_response_sequence(false, None), 0);
    assert_eq!(final_response_sequence(false, Some(7)), 0);
    assert_eq!(final_response_sequence(true, None), 0);
    assert_eq!(final_response_sequence(true, Some(7)), 8);
    assert_eq!(final_response_sequence(true, Some(u32::MAX)), u32::MAX);
}

#[test]
fn partial_response_chunk_drafts_builds_partial_chunks_with_monotonic_sequences() {
    let deltas = vec!["he".to_string(), String::new(), "llo".to_string()];
    assert_eq!(
        partial_response_chunk_drafts(&deltas, None),
        vec![
            ResponseChunkDraft {
                content: "he".to_string(),
                sequence: 0,
                is_final: false,
            },
            ResponseChunkDraft {
                content: "llo".to_string(),
                sequence: 1,
                is_final: false,
            },
        ]
    );
}

#[test]
fn partial_response_chunk_drafts_continue_after_last_sequence() {
    let deltas = vec!["a".to_string(), "b".to_string()];
    let chunks = partial_response_chunk_drafts(&deltas, Some(7));
    assert_eq!(chunks[0].sequence, 8);
    assert_eq!(chunks[1].sequence, 9);
}

#[test]
fn last_response_chunk_sequence_reads_last_draft() {
    assert_eq!(last_response_chunk_sequence(&[]), None);
    let chunks = partial_response_chunk_drafts(&["a".to_string(), "b".to_string()], Some(2));
    assert_eq!(last_response_chunk_sequence(&chunks), Some(4));
    assert_eq!(
        final_response_sequence(true, last_response_chunk_sequence(&chunks)),
        5
    );
}
