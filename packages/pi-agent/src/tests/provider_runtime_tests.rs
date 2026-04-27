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
