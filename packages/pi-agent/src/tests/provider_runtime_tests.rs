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
