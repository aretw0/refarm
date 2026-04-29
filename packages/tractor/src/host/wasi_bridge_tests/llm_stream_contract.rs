#[test]
fn buffered_stream_response_result_preserves_body_and_sequence_without_claiming_chunks() {
    let result = super::buffered_stream_response_result(vec![b'o', b'k'], Some(7));

    assert_eq!(result.final_body, b"ok");
    assert_eq!(result.last_sequence, Some(7));
    assert_eq!(result.stored_chunks, 0);
}

#[test]
fn buffered_stream_response_result_preserves_missing_sequence() {
    let result = super::buffered_stream_response_result(Vec::new(), None);

    assert!(result.final_body.is_empty());
    assert_eq!(result.last_sequence, None);
    assert_eq!(result.stored_chunks, 0);
}
