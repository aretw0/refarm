#[test]
fn provider_runtime_tool_loop_max_iter_defaults_to_five() {
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 5);
}

#[test]
fn provider_runtime_tool_loop_max_iter_reads_env() {
    std::env::set_var("LLM_TOOL_CALL_MAX_ITER", "9");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 9);
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");
}

#[test]
fn provider_runtime_tool_loop_max_iter_invalid_env_falls_back() {
    std::env::set_var("LLM_TOOL_CALL_MAX_ITER", "invalid");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 5);
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");
}

#[test]
fn provider_runtime_dedup_tool_output_marks_duplicates() {
    let mut seen = std::collections::HashSet::new();
    let first = crate::provider_runtime::dedup_tool_output("same-output".to_string(), &mut seen);
    let second = crate::provider_runtime::dedup_tool_output("same-output".to_string(), &mut seen);

    assert_eq!(first, "same-output");
    assert!(second.contains("duplicate"));
}

#[test]
fn provider_runtime_parse_json_arguments_invalid_falls_back_to_object() {
    let v = crate::provider_runtime::parse_json_arguments("{not-json");
    assert_eq!(v, serde_json::json!({}));
}

#[test]
fn provider_runtime_push_executed_call_appends_schema_shape() {
    let mut calls = Vec::new();
    crate::provider_runtime::push_executed_call(
        &mut calls,
        "read_file",
        serde_json::json!({"path":"README.md"}),
        "ok",
    );

    assert_eq!(calls.len(), 1);
    let entry = &calls[0];
    assert_eq!(entry["name"], "read_file");
    assert_eq!(entry["input"]["path"], "README.md");
    assert_eq!(entry["result"], "ok");
}

#[test]
fn provider_runtime_usage_totals_ingest_anthropic_fields() {
    let usage = serde_json::json!({
        "input_tokens": 10,
        "output_tokens": 4,
        "cache_read_input_tokens": 3,
        "cache_creation_input_tokens": 2
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    totals.ingest_anthropic_usage(&usage);

    assert_eq!(totals.tokens_in, 10);
    assert_eq!(totals.tokens_out, 4);
    assert_eq!(totals.tokens_cached, 5);
    assert_eq!(totals.tokens_reasoning, 0);
}

#[test]
fn provider_runtime_usage_totals_ingest_openai_fields() {
    let usage = serde_json::json!({
        "prompt_tokens": 12,
        "completion_tokens": 6,
        "prompt_tokens_details": {"cached_tokens": 7},
        "completion_tokens_details": {"reasoning_tokens": 2}
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    totals.ingest_openai_usage(&usage);

    assert_eq!(totals.tokens_in, 12);
    assert_eq!(totals.tokens_out, 6);
    assert_eq!(totals.tokens_cached, 7);
    assert_eq!(totals.tokens_reasoning, 2);
}

#[test]
fn provider_runtime_should_terminate_tool_loop_when_no_calls() {
    assert!(crate::provider_runtime::should_terminate_tool_loop(
        false, 0, 5
    ));
}

#[test]
fn provider_runtime_should_terminate_tool_loop_when_max_iter_reached() {
    assert!(crate::provider_runtime::should_terminate_tool_loop(
        true, 5, 5
    ));
}

#[test]
fn provider_runtime_should_continue_tool_loop_when_calls_and_not_max() {
    assert!(!crate::provider_runtime::should_terminate_tool_loop(
        true, 2, 5
    ));
}

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
