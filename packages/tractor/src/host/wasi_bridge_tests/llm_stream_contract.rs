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

#[test]
fn complete_http_stream_persists_sse_chunks_from_host_response() {
    let _guard = ENV_LOCK.lock().unwrap();
    reset_llm_env();
    std::env::set_var("LLM_PROVIDER", "ollama");
    let port = mock_sse_server(
        r#"data: {"choices":[{"delta":{"content":"hel"}}]}

data: {"choices":[{"delta":{"content":"lo"}}]}

data: [DONE]

"#,
    );
    let base_url = format!("http://127.0.0.1:{port}");
    std::env::set_var("LLM_BASE_URL", &base_url);

    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "complete-http-stream-test").unwrap();
    let telemetry = crate::telemetry::TelemetryBus::new(16);
    let mut bindings = super::TractorNativeBindings::new("pi-agent", sync.clone(), telemetry);

    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(super::LlmBridgeHost::complete_http_stream(
            &mut bindings,
            "ollama".to_string(),
            base_url,
            "/v1/chat/completions".to_string(),
            Vec::new(),
            b"{}".to_vec(),
            stream_contract_metadata(None),
        ))
        .unwrap();

    assert_eq!(result.stored_chunks, 2);
    assert_eq!(result.last_sequence, Some(1));
    let final_json: serde_json::Value = serde_json::from_slice(&result.final_body).unwrap();
    assert_eq!(final_json["choices"][0]["message"]["content"], "hello");

    let mut payloads: Vec<serde_json::Value> = sync
        .query_nodes("AgentResponse")
        .unwrap()
        .iter()
        .map(|row| serde_json::from_str(&row.payload).unwrap())
        .collect();
    payloads.sort_by_key(|payload| payload["sequence"].as_u64().unwrap());
    assert_eq!(payloads[0]["content"], "hel");
    assert_eq!(payloads[0]["sequence"], 0);
    assert_eq!(payloads[0]["is_final"], false);
    assert_eq!(payloads[1]["content"], "lo");
    assert_eq!(payloads[1]["sequence"], 1);

    reset_llm_env();
}

#[test]
fn complete_http_stream_preserves_route_enforcement() {
    let _guard = ENV_LOCK.lock().unwrap();
    reset_llm_env();
    std::env::set_var("LLM_PROVIDER", "ollama");
    std::env::set_var("LLM_BASE_URL", "http://127.0.0.1:9");

    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let sync = crate::sync::NativeSync::new(storage, "complete-http-stream-route-test").unwrap();
    let telemetry = crate::telemetry::TelemetryBus::new(16);
    let mut bindings = super::TractorNativeBindings::new("pi-agent", sync, telemetry);

    let err = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(super::LlmBridgeHost::complete_http_stream(
            &mut bindings,
            "ollama".to_string(),
            "http://127.0.0.1:10".to_string(),
            "/v1/chat/completions".to_string(),
            Vec::new(),
            b"{}".to_vec(),
            stream_contract_metadata(None),
        ))
        .unwrap_err();

    assert!(err.contains("base_url not allowed"));
    reset_llm_env();
}

fn stream_contract_metadata(last_sequence: Option<u32>) -> super::StreamResponseMetadata {
    super::StreamResponseMetadata {
        prompt_ref: "prompt-123".to_string(),
        model: "gpt-4.1-mini".to_string(),
        provider_family: "ollama".to_string(),
        last_sequence,
    }
}

fn mock_sse_server(body: &'static str) -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0u8; 4096];
        let _ = std::io::Read::read(&mut stream, &mut request).unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        std::io::Write::write_all(&mut stream, response.as_bytes()).unwrap();
    });
    port
}
