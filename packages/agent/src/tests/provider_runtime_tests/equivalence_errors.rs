#[test]
fn provider_runtime_contract_and_state_dispatch_step_error_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-step-error-dispatch",
            vec![("hse".to_string(), "vse".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let state_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        mk_common(),
        "ctx-step-error-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Ok((serde_json::json!({"ok": true}), 81_u8))
        },
        |_state, _phase, _iter_idx, _max_iter, _response, _dispatch| {
            Err("step-boom-dispatch".to_string())
        },
        0_u32,
    ) {
        Ok(_) => panic!("expected dispatch step error"),
        Err(err) => err,
    };

    let contract_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        mk_common(),
        "ctx-step-error-dispatch",
        |_ctx, _model, _headers, _state| {
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": true}),
                81_u8,
            ))
        },
        |_ctx, _state, _contract, _dispatch| Err("step-boom-dispatch".to_string()),
        0_u32,
    ) {
        Ok(_) => panic!("expected dispatch step error"),
        Err(err) => err,
    };

    assert_eq!(state_err, contract_err);
}

#[test]
fn provider_runtime_contract_and_state_dispatch_response_error_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-response-error-dispatch",
            vec![("hre".to_string(), "vre".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let state_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        mk_common(),
        "ctx-response-error-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Err("response-boom-dispatch".to_string())
        },
        |_state, _phase: &u8, _iter_idx, _max_iter, _response, _dispatch| {
            panic!("step should not run when response phase errors")
        },
        0_u32,
    ) {
        Ok(_) => panic!("expected dispatch response error"),
        Err(err) => err,
    };

    let contract_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        mk_common(),
        "ctx-response-error-dispatch",
        |_ctx, _model, _headers, _state| Err("response-boom-dispatch".to_string()),
        |_ctx, _state, _contract: crate::provider_runtime::ProviderIterationContract<'_, u8>, _dispatch| {
            panic!("step should not run when response phase errors")
        },
        0_u32,
    ) {
        Ok(_) => panic!("expected dispatch response error"),
        Err(err) => err,
    };

    assert_eq!(state_err, contract_err);
}

#[test]
fn provider_runtime_contract_and_state_non_dispatch_step_error_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-step-error-no-dispatch",
            vec![("hsen".to_string(), "vsen".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let state_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        mk_common(),
        "ctx-step-error-no-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Ok((serde_json::json!({"ok": true}), 91_u8))
        },
        |_state, _phase, _iter_idx, _max_iter, _response| Err("step-boom-no-dispatch".to_string()),
    ) {
        Ok(_) => panic!("expected non-dispatch step error"),
        Err(err) => err,
    };

    let contract_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        mk_common(),
        "ctx-step-error-no-dispatch",
        |_ctx, _model, _headers, _state| {
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": true}),
                91_u8,
            ))
        },
        |_ctx, _state, _contract| Err("step-boom-no-dispatch".to_string()),
    ) {
        Ok(_) => panic!("expected non-dispatch step error"),
        Err(err) => err,
    };

    assert_eq!(state_err, contract_err);
}

#[test]
fn provider_runtime_contract_and_state_non_dispatch_response_error_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-response-error-no-dispatch",
            vec![("hren".to_string(), "vren".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let state_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        mk_common(),
        "ctx-response-error-no-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Err("response-boom-no-dispatch".to_string())
        },
        |_state, _phase: &u8, _iter_idx, _max_iter, _response| {
            panic!("step should not run when response phase errors")
        },
    ) {
        Ok(_) => panic!("expected non-dispatch response error"),
        Err(err) => err,
    };

    let contract_err = match crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        mk_common(),
        "ctx-response-error-no-dispatch",
        |_ctx, _model, _headers, _state| Err("response-boom-no-dispatch".to_string()),
        |_ctx, _state, _contract: crate::provider_runtime::ProviderIterationContract<'_, u8>| {
            panic!("step should not run when response phase errors")
        },
    ) {
        Ok(_) => panic!("expected non-dispatch response error"),
        Err(err) => err,
    };

    assert_eq!(state_err, contract_err);
}

#[test]
fn provider_runtime_response_error_does_not_execute_step_dispatch_paths() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-no-step-on-response-error-dispatch",
            vec![("hsd".to_string(), "vsd".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let mut state_step_calls = 0_u32;
    let _ = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        mk_common(),
        "ctx-no-step-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Err("response-no-step-dispatch".to_string())
        },
        |_state, _phase: &u8, _iter_idx, _max_iter, _response, _dispatch| {
            state_step_calls += 1;
            Ok(Some("unexpected".to_string()))
        },
        0_u32,
    );

    let mut contract_step_calls = 0_u32;
    let _ = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        mk_common(),
        "ctx-no-step-dispatch",
        |_ctx, _model, _headers, _state| Err("response-no-step-dispatch".to_string()),
        |_ctx, _state, _contract: crate::provider_runtime::ProviderIterationContract<'_, u8>, _dispatch| {
            contract_step_calls += 1;
            Ok(Some("unexpected".to_string()))
        },
        0_u32,
    );

    assert_eq!(state_step_calls, 0);
    assert_eq!(contract_step_calls, 0);
}

#[test]
fn provider_runtime_response_error_does_not_execute_step_non_dispatch_paths() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-no-step-on-response-error-no-dispatch",
            vec![("hsn".to_string(), "vsn".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let mut state_step_calls = 0_u32;
    let _ = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        mk_common(),
        "ctx-no-step-no-dispatch",
        |_ctx, _model, _headers, _wire_msgs, _usage_totals| {
            Err("response-no-step-no-dispatch".to_string())
        },
        |_state, _phase: &u8, _iter_idx, _max_iter, _response| {
            state_step_calls += 1;
            Ok(Some("unexpected".to_string()))
        },
    );

    let mut contract_step_calls = 0_u32;
    let _ = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        mk_common(),
        "ctx-no-step-no-dispatch",
        |_ctx, _model, _headers, _state| Err("response-no-step-no-dispatch".to_string()),
        |_ctx, _state, _contract: crate::provider_runtime::ProviderIterationContract<'_, u8>| {
            contract_step_calls += 1;
            Ok(Some("unexpected".to_string()))
        },
    );

    assert_eq!(state_step_calls, 0);
    assert_eq!(contract_step_calls, 0);
}
