#[test]
fn provider_runtime_run_completion_loop_from_common_config_and_context_with_dispatch_uses_context()
{
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-y",
        vec![("h2".to_string(), "v2".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out =
        crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_dispatch(
            common,
            ("ctx-a", 7_u32),
            |ctx, model, headers, state| {
                assert_eq!(ctx.0, "ctx-a");
                assert_eq!(ctx.1, 7);
                assert_eq!(model, "model-y");
                assert_eq!(headers[0].0, "h2");
                state
                    .wire_msgs
                    .push(serde_json::json!({"role":"assistant","ctx":ctx.0}));
                Ok((serde_json::json!({"ok": true, "ctx": ctx.1}), 0_u8))
            },
            |ctx, _state, _phase, iter_idx, max_iter, _response, dispatch_count| {
                assert_eq!(ctx.0, "ctx-a");
                assert_eq!(iter_idx, 0);
                assert_eq!(max_iter, 0);
                *dispatch_count += ctx.1;
                Ok(Some(format!("done-{dispatch_count}")))
            },
            0_u32,
        )
        .unwrap();

    assert_eq!(out.text, "done-7");
    assert_eq!(out.response["ok"], true);
    assert_eq!(out.response["ctx"], 7);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_and_context_with_state_primitives_uses_state_bindings(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-sp",
        vec![("h".to_string(), "v".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        common,
        "ctx-sp",
        |ctx, model, headers, wire_msgs, usage_totals| {
            assert_eq!(*ctx, "ctx-sp");
            assert_eq!(model, "model-sp");
            assert_eq!(headers[0].0, "h");
            assert_eq!(wire_msgs.len(), 0);
            usage_totals.tokens_out += 2;
            Ok((serde_json::json!({"ok": true}), 9_u8))
        },
        |state, phase, iter_idx, max_iter, response, dispatch| {
            assert_eq!(*phase, 9);
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            assert_eq!(response["ok"], true);
            state.wire_msgs.push(serde_json::json!({"role": "assistant"}));
            *dispatch += 1;
            Ok(Some(format!("state-primitives-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(out.text, "state-primitives-1");
    assert_eq!(out.state.usage_totals.tokens_out, 2);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_and_context_with_state_primitives_without_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-sp2",
        vec![("h2".to_string(), "v2".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_state_primitives(
        common,
        "ctx-no-dispatch",
        |ctx, model, _headers, _wire_msgs, usage_totals| {
            assert_eq!(*ctx, "ctx-no-dispatch");
            assert_eq!(model, "model-sp2");
            usage_totals.tokens_in += 1;
            Ok((serde_json::json!({"ok": true}), 3_u8))
        },
        |_state, phase, iter_idx, max_iter, _response| {
            assert_eq!(*phase, 3);
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            Ok(Some("done-no-dispatch".to_string()))
        },
    )
    .unwrap();

    assert_eq!(out.text, "done-no-dispatch");
    assert_eq!(out.state.usage_totals.tokens_in, 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_with_state_primitives_and_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-sp3",
        vec![("h3".to_string(), "v3".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_with_state_primitives_and_dispatch(
        common,
        |model, headers, wire_msgs, usage_totals| {
            assert_eq!(model, "model-sp3");
            assert_eq!(headers[0].1, "v3");
            assert_eq!(wire_msgs.len(), 0);
            usage_totals.tokens_cached += 4;
            Ok((serde_json::json!({"ok": true}), 11_u8))
        },
        |state, phase, iter_idx, max_iter, response, dispatch| {
            assert_eq!(*phase, 11);
            assert_eq!(iter_idx, 0);
            assert_eq!(max_iter, 0);
            assert_eq!(response["ok"], true);
            state.wire_msgs.push(serde_json::json!({"role": "assistant"}));
            *dispatch += 1;
            Ok(Some(format!("done-dispatch-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(out.text, "done-dispatch-1");
    assert_eq!(out.state.usage_totals.tokens_cached, 4);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_with_contract_primitives_and_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-contract-loop",
        vec![("hc".to_string(), "vc".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_with_contract_primitives_and_dispatch(
        common,
        |model, headers, state| {
            assert_eq!(model, "model-contract-loop");
            assert_eq!(headers[0].0, "hc");
            state.usage_totals.tokens_reasoning += 2;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "contract-loop"}),
                13_u8,
            ))
        },
        |state, contract, dispatch| {
            assert_eq!(*contract.phase, 13);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "contract-loop");
            state
                .wire_msgs
                .push(serde_json::json!({"role": "assistant", "mode": "contract"}));
            *dispatch += 1;
            Ok(Some(format!("contract-loop-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(out.text, "contract-loop-1");
    assert_eq!(out.state.usage_totals.tokens_reasoning, 2);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_with_contract_primitives_without_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-contract-loop-no-dispatch",
        vec![("hcn".to_string(), "vcn".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_with_contract_primitives(
        common,
        |model, headers, state| {
            assert_eq!(model, "model-contract-loop-no-dispatch");
            assert_eq!(headers[0].0, "hcn");
            state.usage_totals.tokens_reasoning += 3;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "contract-loop-no-dispatch"}),
                14_u8,
            ))
        },
        |state, contract| {
            assert_eq!(*contract.phase, 14);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "contract-loop-no-dispatch");
            state
                .wire_msgs
                .push(serde_json::json!({"role": "assistant", "mode": "contract-no-dispatch"}));
            Ok(Some("contract-loop-no-dispatch-done".to_string()))
        },
    )
    .unwrap();

    assert_eq!(out.text, "contract-loop-no-dispatch-done");
    assert_eq!(out.state.usage_totals.tokens_reasoning, 3);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-contract-ctx",
        vec![("hctx".to_string(), "vctx".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        common,
        ("ctx-contract", 9_u32),
        |ctx, model, headers, state| {
            assert_eq!(ctx.0, "ctx-contract");
            assert_eq!(ctx.1, 9);
            assert_eq!(model, "model-contract-ctx");
            assert_eq!(headers[0].1, "vctx");
            state.usage_totals.tokens_in += 5;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "ctx-contract"}),
                21_u8,
            ))
        },
        |ctx, state, contract, dispatch| {
            assert_eq!(ctx.1, 9);
            assert_eq!(*contract.phase, 21);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "ctx-contract");
            state.wire_msgs.push(serde_json::json!({"role": "assistant", "ctx": ctx.0}));
            *dispatch += ctx.1;
            Ok(Some(format!("ctx-contract-{dispatch}")))
        },
        0_u32,
    )
    .unwrap();

    assert_eq!(out.text, "ctx-contract-9");
    assert_eq!(out.state.usage_totals.tokens_in, 5);
    assert_eq!(out.state.wire_msgs.len(), 1);
}
#[test]
fn provider_runtime_run_completion_loop_from_common_config_and_context_with_contract_primitives_without_dispatch_works(
) {
    let common = crate::provider_runtime::provider_runner_common_config(
        "model-contract-ctx-no-dispatch",
        vec![("hctx2".to_string(), "vctx2".to_string())],
        crate::provider_runtime::provider_loop_plan_with_max_iter(Vec::new(), 0),
    );

    let out = crate::provider_runtime::run_completion_loop_from_common_config_and_context_with_contract_primitives(
        common,
        "ctx-contract-no-dispatch",
        |ctx, model, headers, state| {
            assert_eq!(*ctx, "ctx-contract-no-dispatch");
            assert_eq!(model, "model-contract-ctx-no-dispatch");
            assert_eq!(headers[0].0, "hctx2");
            state.usage_totals.tokens_cached += 7;
            Ok(crate::provider_runtime::provider_response_phase_contract(
                serde_json::json!({"ok": "ctx-contract-no-dispatch"}),
                31_u8,
            ))
        },
        |_ctx, state, contract| {
            assert_eq!(*contract.phase, 31);
            assert_eq!(contract.iter_idx, 0);
            assert_eq!(contract.max_iter, 0);
            assert_eq!(contract.response["ok"], "ctx-contract-no-dispatch");
            state.wire_msgs.push(serde_json::json!({"role": "assistant"}));
            Ok(Some("ctx-contract-no-dispatch-done".to_string()))
        },
    )
    .unwrap();

    assert_eq!(out.text, "ctx-contract-no-dispatch-done");
    assert_eq!(out.state.usage_totals.tokens_cached, 7);
    assert_eq!(out.state.wire_msgs.len(), 1);
}

