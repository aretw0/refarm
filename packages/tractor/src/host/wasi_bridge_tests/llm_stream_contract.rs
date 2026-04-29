#[test]
fn buffered_stream_response_result_preserves_body_sequence_and_chunk_count() {
    let result = super::buffered_stream_response_result(vec![b'o', b'k'], Some(7), 2);

    assert_eq!(result.final_body, b"ok");
    assert_eq!(result.last_sequence, Some(7));
    assert_eq!(result.stored_chunks, 2);
}

#[test]
fn buffered_stream_response_result_preserves_missing_sequence() {
    let result = super::buffered_stream_response_result(Vec::new(), None, 0);

    assert!(result.final_body.is_empty());
    assert_eq!(result.last_sequence, None);
    assert_eq!(result.stored_chunks, 0);
}

#[test]
fn validate_stream_response_metadata_accepts_safe_metadata() {
    let metadata = super::StreamResponseMetadata {
        prompt_ref: "prompt-123".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "openai".to_string(),
        last_sequence: Some(41),
    };

    super::validate_stream_response_metadata(&metadata).unwrap();
}

#[test]
fn validate_stream_response_metadata_rejects_blank_prompt_ref() {
    let metadata = super::StreamResponseMetadata {
        prompt_ref: "   ".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "openai".to_string(),
        last_sequence: None,
    };

    let err = super::validate_stream_response_metadata(&metadata).unwrap_err();
    assert!(err.contains("prompt-ref"));
}

#[test]
fn validate_stream_response_metadata_rejects_unsafe_provider_family() {
    let metadata = super::StreamResponseMetadata {
        prompt_ref: "prompt-123".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "OpenAI".to_string(),
        last_sequence: None,
    };

    let err = super::validate_stream_response_metadata(&metadata).unwrap_err();
    assert!(err.contains("provider-family"));
}
