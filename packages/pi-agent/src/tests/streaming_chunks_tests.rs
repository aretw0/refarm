use crate::streaming_chunks::{
    final_response_sequence, first_response_sequence, next_response_sequence,
    should_append_response_chunk_to_session,
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
