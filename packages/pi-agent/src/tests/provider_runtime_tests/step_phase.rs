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
fn provider_runtime_completion_text_if_terminate_returns_none_when_continuing() {
    let v = crate::provider_runtime::completion_text_if_terminate(true, 1, 5, Ok("ok".to_string()))
        .unwrap();
    assert!(v.is_none());
}

#[test]
fn provider_runtime_completion_text_if_terminate_returns_text_when_terminating() {
    let v =
        crate::provider_runtime::completion_text_if_terminate(false, 0, 5, Ok("done".to_string()))
            .unwrap();
    assert_eq!(v.unwrap(), "done");
}

#[test]
fn provider_runtime_completion_text_if_terminate_propagates_error() {
    let err =
        crate::provider_runtime::completion_text_if_terminate(false, 0, 5, Err("boom".to_string()))
            .unwrap_err();
    assert_eq!(err, "boom");
}

#[test]
fn provider_runtime_anthropic_completion_text_if_terminate_returns_some_on_termination() {
    let phase = crate::provider_runtime::anthropic_iteration_phase(&serde_json::json!({
        "content": [{"type":"text","text":"done"}]
    }));
    let v = serde_json::json!({
        "content": [{"type":"text","text":"done"}]
    });

    let out =
        crate::provider_runtime::anthropic_completion_text_if_terminate(&phase, 0, 5, &v).unwrap();
    assert_eq!(out.unwrap(), "done");
}

#[test]
fn provider_runtime_openai_completion_text_if_terminate_returns_none_when_tool_calls_present() {
    let v = serde_json::json!({
        "choices": [{
            "message": {
                "content": "partial",
                "tool_calls": [{
                    "id":"call-1",
                    "function":{"name":"search_files","arguments":"{}"}
                }]
            }
        }]
    });
    let phase = crate::provider_runtime::openai_iteration_phase(&v);

    let out =
        crate::provider_runtime::openai_completion_text_if_terminate(&phase, 1, 5, &v).unwrap();
    assert!(out.is_none());
}

#[test]
fn provider_runtime_anthropic_step_text_or_advance_with_returns_text_on_terminate() {
    let mut state = crate::provider_runtime::anthropic_loop_state(&[]);
    let v = serde_json::json!({
        "content": [{"type":"text","text":"done"}]
    });
    let phase = crate::provider_runtime::anthropic_iteration_phase(&v);

    let out = crate::provider_runtime::anthropic_step_text_or_advance_with(
        &mut state,
        &phase,
        0,
        5,
        &v,
        |_, _, _| "ignored".to_string(),
    )
    .unwrap();

    assert_eq!(out.unwrap(), "done");
    assert!(state.executed_calls.is_empty());
    assert!(state.wire_msgs.is_empty());
}

#[test]
fn provider_runtime_openai_step_text_or_advance_with_advances_when_continuing() {
    let mut state = crate::provider_runtime::openai_loop_state("sys", &[]);
    let v = serde_json::json!({
        "choices": [{
            "message": {
                "content": "partial",
                "tool_calls": [{
                    "id":"call-1",
                    "function":{"name":"search_files","arguments":"{\"pattern\":\"TODO\"}"}
                }]
            }
        }]
    });
    let phase = crate::provider_runtime::openai_iteration_phase(&v);

    let out = crate::provider_runtime::openai_step_text_or_advance_with(
        &mut state,
        &phase,
        1,
        5,
        &v,
        |name, input, _| format!("{name}:{}", input["pattern"].as_str().unwrap_or("")),
    )
    .unwrap();

    assert!(out.is_none());
    assert_eq!(state.wire_msgs.len(), 3);
    assert_eq!(state.wire_msgs[1]["role"], "assistant");
    assert_eq!(state.wire_msgs[2]["role"], "tool");
    assert_eq!(state.executed_calls.len(), 1);
}

#[test]
fn provider_runtime_step_text_or_advance_with_returns_text_when_terminated() {
    let mut state = crate::provider_runtime::provider_loop_state(Vec::new());
    let phase = 0_u8;
    let response = serde_json::json!({"ok": true});

    let out = crate::provider_runtime::step_text_or_advance_with(
        &mut state,
        &phase,
        0,
        5,
        &response,
        |_phase, _iter, _max, _response| Ok(Some("done".to_string())),
        |_state, _phase| panic!("advance should not run"),
    )
    .unwrap();

    assert_eq!(out, Some("done".to_string()));
}

#[test]
fn provider_runtime_step_text_or_advance_with_advances_when_continuing() {
    let mut state = crate::provider_runtime::provider_loop_state(Vec::new());
    let phase = 9_u8;
    let response = serde_json::json!({"ok": true});

    let out = crate::provider_runtime::step_text_or_advance_with(
        &mut state,
        &phase,
        0,
        5,
        &response,
        |_phase, _iter, _max, _response| Ok(None),
        |state, phase| {
            state
                .executed_calls
                .push(serde_json::json!({"phase": phase}));
        },
    )
    .unwrap();

    assert!(out.is_none());
    assert_eq!(state.executed_calls.len(), 1);
    assert_eq!(state.executed_calls[0]["phase"], 9);
}

#[test]
fn provider_runtime_anthropic_step_from_phase_with_dispatch_advances_when_continuing() {
    let mut state = crate::provider_runtime::anthropic_loop_state(&[]);
    let response = serde_json::json!({
        "content": [
            {"type":"text","text":"thinking"},
            {"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}
        ]
    });
    let phase = crate::provider_runtime::anthropic_iteration_phase(&response);
    let mut dispatch =
        |name: &str, input: &serde_json::Value, _seen: &mut std::collections::HashSet<u64>| {
            format!("{name}:{}", input["path"].as_str().unwrap_or(""))
        };

    let out = crate::provider_runtime::anthropic_step_from_phase_with_dispatch(
        &mut state,
        &phase,
        1,
        5,
        &response,
        &mut dispatch,
    )
    .unwrap();

    assert!(out.is_none());
    assert_eq!(state.wire_msgs.len(), 2);
    assert_eq!(state.executed_calls.len(), 1);
}

#[test]
fn provider_runtime_openai_step_from_phase_with_dispatch_advances_when_continuing() {
    let mut state = crate::provider_runtime::openai_loop_state("sys", &[]);
    let response = serde_json::json!({
        "choices": [{
            "message": {
                "content": "partial",
                "tool_calls": [{
                    "id":"call-1",
                    "function":{"name":"search_files","arguments":"{\"pattern\":\"TODO\"}"}
                }]
            }
        }]
    });
    let phase = crate::provider_runtime::openai_iteration_phase(&response);
    let mut dispatch =
        |name: &str, input: &serde_json::Value, _seen: &mut std::collections::HashSet<u64>| {
            format!("{name}:{}", input["pattern"].as_str().unwrap_or(""))
        };

    let out = crate::provider_runtime::openai_step_from_phase_with_dispatch(
        &mut state,
        &phase,
        1,
        5,
        &response,
        &mut dispatch,
    )
    .unwrap();

    assert!(out.is_none());
    assert_eq!(state.wire_msgs.len(), 3);
    assert_eq!(state.executed_calls.len(), 1);
}

