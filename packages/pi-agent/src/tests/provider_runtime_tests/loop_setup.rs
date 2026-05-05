#[test]
fn provider_runtime_provider_loop_state_initializes_empty_runtime_fields() {
    let state = crate::provider_runtime::provider_loop_state(vec![serde_json::json!({
        "role": "system",
        "content": "s"
    })]);

    assert_eq!(state.wire_msgs.len(), 1);
    assert_eq!(state.usage_totals.tokens_in, 0);
    assert!(state.executed_calls.is_empty());
    assert!(state.seen_hashes.is_empty());
}
#[test]
fn provider_runtime_anthropic_loop_state_bootstraps_wire_history() {
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let state = crate::provider_runtime::anthropic_loop_state(&msgs);

    assert_eq!(state.wire_msgs.len(), 1);
    assert_eq!(state.wire_msgs[0]["role"], "user");
    assert_eq!(state.wire_msgs[0]["content"], "hello");
}
#[test]
fn provider_runtime_openai_loop_state_prepends_system_message() {
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let state = crate::provider_runtime::openai_loop_state("sys", &msgs);

    assert_eq!(state.wire_msgs.len(), 2);
    assert_eq!(state.wire_msgs[0]["role"], "system");
    assert_eq!(state.wire_msgs[1]["role"], "user");
}
#[test]
fn provider_runtime_anthropic_loop_plan_reads_max_iter_and_initializes_state() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("LLM_TOOL_CALL_MAX_ITER", "7");
    let msgs = vec![("user".to_string(), "hi".to_string())];
    let plan = crate::provider_runtime::anthropic_loop_plan(&msgs);
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");

    assert_eq!(plan.max_iter, 7);
    assert_eq!(plan.state.wire_msgs.len(), 1);
    assert!(plan.state.executed_calls.is_empty());
}
#[test]
fn provider_runtime_provider_loop_plan_with_max_iter_applies_explicit_limit() {
    let plan = crate::provider_runtime::provider_loop_plan_with_max_iter(
        vec![serde_json::json!({"role":"user","content":"x"})],
        3,
    );

    assert_eq!(plan.max_iter, 3);
    assert_eq!(plan.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_openai_loop_plan_prepends_system_and_sets_default_max_iter() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let plan = crate::provider_runtime::openai_loop_plan("sys", &msgs);

    assert_eq!(plan.max_iter, 5);
    assert_eq!(plan.state.wire_msgs.len(), 2);
    assert_eq!(plan.state.wire_msgs[0]["role"], "system");
}
#[test]
fn provider_runtime_provider_runner_common_config_keeps_model_headers_and_plan() {
    let plan = crate::provider_runtime::provider_loop_plan_with_max_iter(
        vec![serde_json::json!({"role":"user","content":"hello"})],
        2,
    );
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-x",
        vec![("content-type".to_string(), "application/json".to_string())],
        plan,
    );

    assert_eq!(common.model, "model-x");
    assert_eq!(common.headers.len(), 1);
    assert_eq!(common.plan.max_iter, 2);
    assert_eq!(common.plan.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_anthropic_runner_config_builds_headers_and_plan() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("LLM_TOOL_CALL_MAX_ITER", "4");
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let cfg = crate::provider_runtime::anthropic_runner_config("m", "s", &msgs);
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");

    assert_eq!(cfg.common.model, "m");
    assert_eq!(cfg.system, "s");
    assert_eq!(cfg.common.plan.max_iter, 4);
    assert_eq!(cfg.common.headers[0].0, "content-type");
}
#[test]
fn provider_runtime_openai_runner_config_builds_headers_and_plan() {
    let _guard = super::ENV_LOCK.lock().unwrap();
    std::env::set_var("LLM_TOOL_CALL_MAX_ITER", "6");
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let cfg = crate::provider_runtime::openai_runner_config(
        "openai",
        "http://localhost:11434",
        "gpt-x",
        "sys",
        &msgs,
    );
    std::env::remove_var("LLM_TOOL_CALL_MAX_ITER");

    assert_eq!(cfg.provider, "openai");
    assert_eq!(cfg.base_url, "http://localhost:11434");
    assert_eq!(cfg.common.model, "gpt-x");
    assert_eq!(cfg.common.plan.max_iter, 6);
    assert_eq!(cfg.common.headers[0].0, "content-type");
}
