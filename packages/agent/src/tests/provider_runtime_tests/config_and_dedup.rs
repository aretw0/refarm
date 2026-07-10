#[test]
fn provider_runtime_tool_loop_max_iter_defaults_to_coding_realistic() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::remove_var("MODEL_TOOL_CALL_MAX_ITER");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 25);
}
#[test]
fn provider_runtime_tool_loop_max_iter_reads_env() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("MODEL_TOOL_CALL_MAX_ITER", "9");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 9);
    std::env::remove_var("MODEL_TOOL_CALL_MAX_ITER");
}
#[test]
fn provider_runtime_tool_loop_max_iter_invalid_env_falls_back() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("MODEL_TOOL_CALL_MAX_ITER", "invalid");
    assert_eq!(crate::provider_runtime::tool_loop_max_iter(), 25);
    std::env::remove_var("MODEL_TOOL_CALL_MAX_ITER");
}
#[test]
fn provider_runtime_max_output_tokens_defaults_to_4096() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::remove_var("MODEL_MAX_TOKENS");
    // The default is the modern ceiling, NOT the old hardcoded 1024 that truncated
    // long files/patches. This is the drift-sensor for the max_tokens unlock.
    assert_eq!(crate::provider_runtime::max_output_tokens(), 4096);
}
#[test]
fn provider_runtime_max_output_tokens_reads_env() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("MODEL_MAX_TOKENS", "16000");
    assert_eq!(crate::provider_runtime::max_output_tokens(), 16000);
    std::env::remove_var("MODEL_MAX_TOKENS");
}
#[test]
fn provider_runtime_max_output_tokens_invalid_or_zero_falls_back() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("MODEL_MAX_TOKENS", "0");
    assert_eq!(crate::provider_runtime::max_output_tokens(), 4096); // 0 is rejected
    std::env::set_var("MODEL_MAX_TOKENS", "nonsense");
    assert_eq!(crate::provider_runtime::max_output_tokens(), 4096);
    std::env::remove_var("MODEL_MAX_TOKENS");
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
fn provider_runtime_dispatch_and_dedup_with_passthrough_then_duplicate() {
    let mut seen = std::collections::HashSet::new();

    let first = crate::provider_runtime::dispatch_and_dedup_with(
        "read_file",
        &serde_json::json!({"path":"README.md"}),
        &mut seen,
        |name, input| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );
    let second = crate::provider_runtime::dispatch_and_dedup_with(
        "read_file",
        &serde_json::json!({"path":"README.md"}),
        &mut seen,
        |name, input| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );

    assert_eq!(first, "read_file:README.md");
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
