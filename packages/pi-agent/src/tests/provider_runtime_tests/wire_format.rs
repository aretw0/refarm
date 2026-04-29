#[test]
fn provider_runtime_error_message_uses_fallback_when_missing() {
    let v = serde_json::json!({});
    assert_eq!(
        crate::provider_runtime::error_message(&v, "fallback"),
        "fallback"
    );
}

#[test]
fn provider_runtime_error_message_prefers_payload_message() {
    let v = serde_json::json!({"error": {"message": "boom"}});
    assert_eq!(
        crate::provider_runtime::error_message(&v, "fallback"),
        "boom"
    );
}

#[test]
fn provider_runtime_append_anthropic_assistant_message_shape() {
    let mut wire_msgs = Vec::new();
    let blocks = vec![serde_json::json!({"type":"text","text":"hello"})];
    crate::provider_runtime::append_anthropic_assistant_message(&mut wire_msgs, &blocks);

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[0]["content"][0]["text"], "hello");
}

#[test]
fn provider_runtime_append_anthropic_tool_results_message_shape() {
    let mut wire_msgs = Vec::new();
    let tool_results = vec![serde_json::json!({"type":"tool_result","content":"ok"})];
    crate::provider_runtime::append_anthropic_tool_results_message(&mut wire_msgs, tool_results);

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "user");
    assert_eq!(wire_msgs[0]["content"][0]["type"], "tool_result");
}

#[test]
fn provider_runtime_append_openai_assistant_message_shape() {
    let mut wire_msgs = Vec::new();
    let tool_calls = vec![serde_json::json!({"id":"call_1"})];
    crate::provider_runtime::append_openai_assistant_message(
        &mut wire_msgs,
        &serde_json::json!("partial"),
        &tool_calls,
    );

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[0]["content"], "partial");
    assert_eq!(wire_msgs[0]["tool_calls"][0]["id"], "call_1");
}

#[test]
fn provider_runtime_append_openai_tool_message_shape() {
    let mut wire_msgs = Vec::new();
    crate::provider_runtime::append_openai_tool_message(&mut wire_msgs, "call_2", "done".into());

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "tool");
    assert_eq!(wire_msgs[0]["tool_call_id"], "call_2");
    assert_eq!(wire_msgs[0]["content"], "done");
}

#[test]
fn provider_runtime_openai_compat_path_known_overrides() {
    assert_eq!(
        crate::provider_runtime::openai_compat_path("groq"),
        "/openai/v1/chat/completions"
    );
    assert_eq!(
        crate::provider_runtime::openai_compat_path("openrouter"),
        "/api/v1/chat/completions"
    );
    assert_eq!(
        crate::provider_runtime::openai_compat_path("gemini"),
        "/v1beta/openai/chat/completions"
    );
}

#[test]
fn provider_runtime_openai_compat_path_default() {
    assert_eq!(
        crate::provider_runtime::openai_compat_path("unknown"),
        "/v1/chat/completions"
    );
}

#[test]
fn provider_runtime_parse_response_json_reports_error() {
    let err = crate::provider_runtime::parse_response_json(b"{").unwrap_err();
    assert!(err.contains("parse:"));
}

#[test]
fn provider_runtime_build_openai_body_includes_expected_fields() {
    let body = crate::provider_runtime::build_openai_body(
        "m",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([{"type":"function"}]),
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "m");
    assert_eq!(v["max_tokens"], 1024);
    assert_eq!(v["messages"][0]["role"], "user");
    assert_eq!(v["tools"][0]["type"], "function");
    assert!(v.get("stream").is_none());
}

#[test]
fn provider_runtime_build_openai_body_can_request_streaming() {
    let body = crate::provider_runtime::build_openai_body_with_streaming(
        "m",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([]),
        true,
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["stream"], true);
}

#[test]
fn provider_runtime_build_anthropic_body_includes_expected_fields() {
    let body = crate::provider_runtime::build_anthropic_body(
        "m2",
        "sys",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([{"name":"read_file"}]),
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "m2");
    assert_eq!(v["system"], "sys");
    assert_eq!(v["max_tokens"], 1024);
    assert_eq!(v["messages"][0]["role"], "user");
    assert_eq!(v["tools"][0]["name"], "read_file");
    assert!(v.get("stream").is_none());
}

#[test]
fn provider_runtime_build_anthropic_body_can_request_streaming() {
    let body = crate::provider_runtime::build_anthropic_body_with_streaming(
        "m2",
        "sys",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([]),
        true,
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["stream"], true);
}

#[test]
fn provider_runtime_headers_include_content_type() {
    let a = crate::provider_runtime::anthropic_headers();
    let o = crate::provider_runtime::openai_compat_headers();
    assert!(a
        .iter()
        .any(|(k, v)| k == "content-type" && v == "application/json"));
    assert!(o
        .iter()
        .any(|(k, v)| k == "content-type" && v == "application/json"));
}

#[test]
fn provider_runtime_initial_anthropic_wire_messages_maps_history() {
    let msgs = vec![
        ("user".to_string(), "a".to_string()),
        ("assistant".to_string(), "b".to_string()),
    ];
    let wire = crate::provider_runtime::initial_anthropic_wire_messages(&msgs);

    assert_eq!(wire.len(), 2);
    assert_eq!(wire[0]["role"], "user");
    assert_eq!(wire[1]["content"], "b");
}

#[test]
fn provider_runtime_initial_openai_wire_messages_prepends_system() {
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let wire = crate::provider_runtime::initial_openai_wire_messages("sys", &msgs);

    assert_eq!(wire.len(), 2);
    assert_eq!(wire[0]["role"], "system");
    assert_eq!(wire[0]["content"], "sys");
    assert_eq!(wire[1]["role"], "user");
}

#[test]
fn provider_runtime_anthropic_content_array_defaults_to_empty() {
    let v = serde_json::json!({});
    let arr = crate::provider_runtime::anthropic_content_array(&v);
    assert!(arr.is_empty());
}

#[test]
fn provider_runtime_openai_tool_calls_array_defaults_to_empty() {
    let msg = serde_json::json!({});
    let arr = crate::provider_runtime::openai_tool_calls_array(&msg);
    assert!(arr.is_empty());
}

#[test]
fn provider_runtime_parse_anthropic_tool_uses_extracts_fields() {
    let content_arr = vec![
        serde_json::json!({"type":"text","text":"x"}),
        serde_json::json!({"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}),
    ];
    let parsed = crate::provider_runtime::parse_anthropic_tool_uses(&content_arr);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "read_file");
    assert_eq!(parsed[0].input["path"], "README.md");
    assert_eq!(parsed[0].id, "t1");
}

#[test]
fn provider_runtime_anthropic_text_content_prefers_text_block() {
    let content_arr = vec![
        serde_json::json!({"type":"tool_use","name":"x"}),
        serde_json::json!({"type":"text","text":"done"}),
    ];
    assert_eq!(
        crate::provider_runtime::anthropic_text_content(&content_arr).unwrap(),
        "done"
    );
}

#[test]
fn provider_runtime_parse_openai_tool_calls_extracts_fields() {
    let tool_calls = vec![serde_json::json!({
        "id":"call_1",
        "function":{"name":"read_file","arguments":"{\"path\":\"Cargo.toml\"}"}
    })];
    let parsed = crate::provider_runtime::parse_openai_tool_calls(&tool_calls);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "read_file");
    assert_eq!(parsed[0].input["path"], "Cargo.toml");
    assert_eq!(parsed[0].id, "call_1");
}

#[test]
fn provider_runtime_openai_message_content_reads_string() {
    let msg = serde_json::json!({"content":"final"});
    assert_eq!(
        crate::provider_runtime::openai_message_content(&msg).unwrap(),
        "final"
    );
}

#[test]
fn provider_runtime_anthropic_tool_result_shape() {
    let r = crate::provider_runtime::anthropic_tool_result("id-1", "ok".to_string());
    assert_eq!(r["type"], "tool_result");
    assert_eq!(r["tool_use_id"], "id-1");
    assert_eq!(r["content"], "ok");
}

#[test]
fn provider_runtime_require_anthropic_text_content_returns_error_when_missing() {
    let content_arr = vec![serde_json::json!({"type":"tool_use","name":"x"})];
    let response = serde_json::json!({"error": {"message": "boom"}});
    let err = crate::provider_runtime::require_anthropic_text_content(&content_arr, &response)
        .unwrap_err();
    assert_eq!(err, "boom");
}

#[test]
fn provider_runtime_openai_choice_message_reads_first_choice_message() {
    let response = serde_json::json!({
        "choices": [{"message": {"content": "hello"}}]
    });
    let msg = crate::provider_runtime::openai_choice_message(&response);
    assert_eq!(msg["content"], "hello");
}

#[test]
fn provider_runtime_require_openai_message_content_returns_error_when_missing() {
    let msg = serde_json::json!({});
    let response = serde_json::json!({"error": {"message": "nope"}});
    let err = crate::provider_runtime::require_openai_message_content(&msg, &response).unwrap_err();
    assert_eq!(err, "nope");
}

#[test]
fn provider_runtime_parse_sse_data_events_extracts_provider_payloads() {
    let events = crate::provider_runtime::parse_sse_data_events(
        b": ping\n\ndata: {\"type\":\"content_block_delta\"}\n\ndata: [DONE]\n\ndata: {\"choices\":[{}]}\n",
    );
    assert_eq!(
        events,
        vec![
            r#"{"type":"content_block_delta"}"#.to_string(),
            r#"{"choices":[{}]}"#.to_string(),
        ]
    );
}

#[test]
fn provider_runtime_parse_stream_text_deltas_reads_openai_and_anthropic_payloads() {
    let payloads = vec![
        r#"{"choices":[{"delta":{"content":"hel"}}]}"#.to_string(),
        r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}"#.to_string(),
        r#"{"choices":[{"delta":{}}]}"#.to_string(),
        "not json".to_string(),
    ];
    assert_eq!(
        crate::provider_runtime::parse_stream_text_deltas(&payloads),
        vec!["hel".to_string(), "lo".to_string()]
    );
}
