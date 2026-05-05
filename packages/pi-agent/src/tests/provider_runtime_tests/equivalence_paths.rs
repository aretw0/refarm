#[test]
fn provider_runtime_contract_and_state_primitives_dispatch_paths_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-dispatch",
            vec![("heq".to_string(), "veq".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(
                vec![serde_json::json!({"role": "user", "content": "ping"})],
                0,
            ),
        )
    };

    let state_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        mk_common(),
        ("ctx-eq", 3_u32),
        |ctx, model, headers, wire_msgs, usage_totals| {
            assert_eq!(ctx.0, "ctx-eq");
            assert_eq!(model, "model-eq-dispatch");
            assert_eq!(headers[0].0, "heq");
            assert_eq!(wire_msgs.len(), 1);
            usage_totals.tokens_in += 2;
            Ok((serde_json::json!({"ok": "eq", "n": ctx.1}), 41_u8))
        },
        |state, phase, iter_idx, max_iter, response, dispatch| {
            assert_eq!(*phase, 41);
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            assert_eq!(response["ok"], "eq");
            state
                .wire_msgs
                .push(serde_json::json!({"role": "assistant", "mode": "eq"}));
            *dispatch += 1;
            Ok(Some(format!("eq-dispatch-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    let contract_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        mk_common(),
        ("ctx-eq", 3_u32),
        |ctx, model, headers, state| {
            assert_eq!(ctx.0, "ctx-eq");
            assert_eq!(model, "model-eq-dispatch");
            assert_eq!(headers[0].0, "heq");
            assert_eq!(state.wire_msgs.len(), 1);
            state.usage_totals.tokens_in += 2;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "eq", "n": ctx.1}),
                41_u8,
            ))
        },
        |_ctx, state, contract, dispatch| {
            assert_eq!(*contract.phase, 41);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "eq");
            state
                .wire_msgs
                .push(serde_json::json!({"role": "assistant", "mode": "eq"}));
            *dispatch += 1;
            Ok(Some(format!("eq-dispatch-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(state_out.text, contract_out.text);
    assert_eq!(state_out.response, contract_out.response);
    assert_eq!(state_out.state.usage_totals.tokens_in, 2);
    assert_eq!(state_out.state.usage_totals.tokens_in, contract_out.state.usage_totals.tokens_in);
    assert_eq!(state_out.state.wire_msgs, contract_out.state.wire_msgs);
}

#[test]
fn provider_runtime_contract_and_state_primitives_non_dispatch_paths_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-no-dispatch",
            vec![("heq2".to_string(), "veq2".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
        )
    };

    let state_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        mk_common(),
        "ctx-eq-no-dispatch",
        |ctx, model, _headers, wire_msgs, usage_totals| {
            assert_eq!(*ctx, "ctx-eq-no-dispatch");
            assert_eq!(model, "model-eq-no-dispatch");
            assert_eq!(wire_msgs.len(), 0);
            usage_totals.tokens_cached += 9;
            Ok((serde_json::json!({"ok": "eq-no-dispatch"}), 51_u8))
        },
        |state, phase, iter_idx, max_iter, response| {
            assert_eq!(*phase, 51);
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            assert_eq!(response["ok"], "eq-no-dispatch");
            state.wire_msgs.push(serde_json::json!({"role": "assistant"}));
            Ok(Some("eq-no-dispatch-done".to_string()))
        },
    )
    .unwrap();

    let contract_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        mk_common(),
        "ctx-eq-no-dispatch",
        |ctx, model, _headers, state| {
            assert_eq!(*ctx, "ctx-eq-no-dispatch");
            assert_eq!(model, "model-eq-no-dispatch");
            assert_eq!(state.wire_msgs.len(), 0);
            state.usage_totals.tokens_cached += 9;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "eq-no-dispatch"}),
                51_u8,
            ))
        },
        |_ctx, state, contract| {
            assert_eq!(*contract.phase, 51);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "eq-no-dispatch");
            state.wire_msgs.push(serde_json::json!({"role": "assistant"}));
            Ok(Some("eq-no-dispatch-done".to_string()))
        },
    )
    .unwrap();

    assert_eq!(state_out.text, contract_out.text);
    assert_eq!(state_out.response, contract_out.response);
    assert_eq!(state_out.state.usage_totals.tokens_cached, 9);
    assert_eq!(
        state_out.state.usage_totals.tokens_cached,
        contract_out.state.usage_totals.tokens_cached
    );
    assert_eq!(state_out.state.wire_msgs, contract_out.state.wire_msgs);
}

#[test]
fn provider_runtime_contract_and_state_dispatch_max_iter_termination_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-max-dispatch",
            vec![("hmx".to_string(), "vmx".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 2),
        )
    };

    let mut state_calls = 0_u32;
    let state_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        mk_common(),
        "ctx-max-dispatch",
        |_ctx, _model, _headers, _wire_msgs, usage_totals| {
            state_calls += 1;
            usage_totals.tokens_out += 1;
            Ok((serde_json::json!({"iter": state_calls}), 61_u8))
        },
        |state, _phase, iter_idx, max_iter, response, dispatch| {
            if iter_idx == max_iter {
                Ok(Some(format!("done-max-dispatch-{iter_idx}-{}", response["iter"])))
            } else {
                *dispatch += 1;
                state
                    .wire_msgs
                    .push(serde_json::json!({"role": "assistant", "iter": iter_idx}));
                Ok(None)
            }
        },
        0_u32,
    )
    .unwrap();

    let mut contract_calls = 0_u32;
    let contract_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        mk_common(),
        "ctx-max-dispatch",
        |_ctx, _model, _headers, state| {
            contract_calls += 1;
            state.usage_totals.tokens_out += 1;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"iter": contract_calls}),
                61_u8,
            ))
        },
        |_ctx, state, contract, dispatch| {
            if contract.iter_idx == contract.max_iter {
                Ok(Some(format!(
                    "done-max-dispatch-{}-{}",
                    contract.iter_idx, contract.response["iter"]
                )))
            } else {
                *dispatch += 1;
                state.wire_msgs.push(serde_json::json!({
                    "role": "assistant",
                    "iter": contract.iter_idx
                }));
                Ok(None)
            }
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(state_out.text, contract_out.text);
    assert_eq!(state_out.response, contract_out.response);
    assert_eq!(state_out.state.usage_totals.tokens_out, 3);
    assert_eq!(
        state_out.state.usage_totals.tokens_out,
        contract_out.state.usage_totals.tokens_out
    );
    assert_eq!(state_out.state.wire_msgs, contract_out.state.wire_msgs);
}

#[test]
fn provider_runtime_contract_and_state_non_dispatch_max_iter_termination_are_equivalent() {
    let mk_common = || {
        crate::provider_runtime::provider_runner_common_config(
            "model-eq-max-no-dispatch",
            vec![("hmn".to_string(), "vmn".to_string())],
            crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 2),
        )
    };

    let mut state_calls = 0_u32;
    let state_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        mk_common(),
        "ctx-max-no-dispatch",
        |_ctx, _model, _headers, _wire_msgs, usage_totals| {
            state_calls += 1;
            usage_totals.tokens_reasoning += 1;
            Ok((serde_json::json!({"iter": state_calls}), 71_u8))
        },
        |state, _phase, iter_idx, max_iter, response| {
            if iter_idx == max_iter {
                Ok(Some(format!("done-max-no-dispatch-{iter_idx}-{}", response["iter"])))
            } else {
                state
                    .wire_msgs
                    .push(serde_json::json!({"role": "assistant", "iter": iter_idx}));
                Ok(None)
            }
        },
    )
    .unwrap();

    let mut contract_calls = 0_u32;
    let contract_out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        mk_common(),
        "ctx-max-no-dispatch",
        |_ctx, _model, _headers, state| {
            contract_calls += 1;
            state.usage_totals.tokens_reasoning += 1;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"iter": contract_calls}),
                71_u8,
            ))
        },
        |_ctx, state, contract| {
            if contract.iter_idx == contract.max_iter {
                Ok(Some(format!(
                    "done-max-no-dispatch-{}-{}",
                    contract.iter_idx, contract.response["iter"]
                )))
            } else {
                state.wire_msgs.push(serde_json::json!({
                    "role": "assistant",
                    "iter": contract.iter_idx
                }));
                Ok(None)
            }
        },
    )
    .unwrap();

    assert_eq!(state_out.text, contract_out.text);
    assert_eq!(state_out.response, contract_out.response);
    assert_eq!(state_out.state.usage_totals.tokens_reasoning, 3);
    assert_eq!(
        state_out.state.usage_totals.tokens_reasoning,
        contract_out.state.usage_totals.tokens_reasoning
    );
    assert_eq!(state_out.state.wire_msgs, contract_out.state.wire_msgs);
}

