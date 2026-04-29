#[test]
fn provider_runtime_run_completion_loop_with_returns_text_and_final_state() {
    let state = crate::provider_runtime::provider_loop_state(Vec::new());

    let outcome = crate::provider_runtime::run_completion_loop_with(
        5,
        state,
        |state| {
            state
                .wire_msgs
                .push(serde_json::json!({"role":"assistant"}));
            Ok((serde_json::json!({"ok": true}), 0_u8))
        },
        |state, _phase, iter_idx, _max_iter, _response| {
            state
                .executed_calls
                .push(serde_json::json!({"iter": iter_idx}));
            Ok(Some("done".to_string()))
        },
    )
    .unwrap();

    assert_eq!(outcome.text, "done");
    assert_eq!(outcome.response["ok"], true);
    assert_eq!(outcome.state.wire_msgs.len(), 1);
    assert_eq!(outcome.state.executed_calls.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_with_propagates_step_error() {
    let state = crate::provider_runtime::provider_loop_state(Vec::new());

    let out = crate::provider_runtime::run_completion_loop_with(
        5,
        state,
        |_state| Ok((serde_json::json!({"ok": true}), 0_u8)),
        |_state, _phase, _iter_idx, _max_iter, _response| Err("boom".to_string()),
    );

    match out {
        Ok(_) => panic!("expected step error"),
        Err(err) => assert_eq!(err, "boom"),
    }
}
#[test]
fn provider_runtime_run_completion_loop_from_plan_with_uses_plan_max_iter() {
    let plan = crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0);

    let outcome = crate::provider_runtime::run_completion_loop_from_plan_with(
        plan,
        |state| {
            state
                .wire_msgs
                .push(serde_json::json!({"role":"assistant"}));
            Ok((serde_json::json!({"ok": true}), 0_u8))
        },
        |_state, _phase, iter_idx, max_iter, _response| {
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            Ok(Some("done".to_string()))
        },
    )
    .unwrap();

    assert_eq!(outcome.text, "done");
}
#[test]
fn provider_runtime_run_completion_loop_from_plan_with_dispatch_uses_dispatch_state() {
    let plan = crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0);

    let outcome = crate::provider_runtime::run_completion_loop_from_plan_with_dispatch(
        plan,
        |state| {
            state
                .wire_msgs
                .push(serde_json::json!({"role":"assistant"}));
            Ok((serde_json::json!({"ok": true}), 0_u8))
        },
        |_state, _phase, _iter_idx, _max_iter, _response, dispatch_count| {
            *dispatch_count += 1;
            Ok(Some(format!("done-{}", *dispatch_count)))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(outcome.text, "done-1");
}
#[test]
fn provider_runtime_run_completion_loop_from_plan_with_dispatch_propagates_step_error() {
    let plan = crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0);

    let out = crate::provider_runtime::run_completion_loop_from_plan_with_dispatch(
        plan,
        |_state| Ok((serde_json::json!({"ok": true}), 0_u8)),
        |_state, _phase, _iter_idx, _max_iter, _response, _dispatch| Err("boom".to_string()),
        (),
    );

    match out {
        Ok(_) => panic!("expected step error"),
        Err(err) => assert_eq!(err, "boom"),
    }
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_with_dispatch_uses_common_fields() {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-z",
        vec![("h".to_string(), "v".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_with_dispatch(
        common,
        |model, headers, state| {
            assert_eq!(model, "model-z");
            assert_eq!(headers[0].0, "h");
            state
                .wire_msgs
                .push(serde_json::json!({"role":"assistant"}));
            Ok((serde_json::json!({"ok": true}), 0_u8))
        },
        |_state, _phase, iter_idx, max_iter, _response, dispatch_count| {
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            *dispatch_count += 1;
            Ok(Some(format!("done-{dispatch_count}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(out.text, "done-1");
    assert_eq!(out.response["ok"], true);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
