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

#[test]
fn provider_runtime_response_and_phase_from_state_with_passes_state_fields_to_closure() {
    let mut state = crate::provider_runtime::provider_loop_state(vec![serde_json::json!({
        "role": "user",
        "content": "hello"
    })]);
    let model = "m1";
    let headers = vec![("h".to_string(), "v".to_string())];

    let (response, phase) = crate::provider_runtime::response_and_phase_from_state_with(
        &"ctx",
        model,
        &headers,
        &mut state,
        |ctx, model, headers, wire_msgs, usage_totals| {
            assert_eq!(*ctx, "ctx");
            assert_eq!(model, "m1");
            assert_eq!(headers[0].0, "h");
            assert_eq!(wire_msgs.len(), 1);
            usage_totals.tokens_in += 3;
            Ok((serde_json::json!({"ok": true}), 42_u8))
        },
    )
    .unwrap();

    assert_eq!(response["ok"], true);
    assert_eq!(phase, 42);
    assert_eq!(state.usage_totals.tokens_in, 3);
}

#[test]
fn provider_runtime_response_phase_contract_from_state_with_builds_contract() {
    let mut state = crate::provider_runtime::provider_loop_state(vec![serde_json::json!({
        "role": "user",
        "content": "hello-contract"
    })]);

    let contract = crate::provider_runtime::response_phase_contract_from_state_with(
        &"ctx-contract",
        "m-contract",
        &[("h".to_string(), "v".to_string())],
        &mut state,
        |ctx, model, headers, wire_msgs, usage_totals| {
            assert_eq!(*ctx, "ctx-contract");
            assert_eq!(model, "m-contract");
            assert_eq!(headers[0].1, "v");
            assert_eq!(wire_msgs.len(), 1);
            usage_totals.tokens_out += 6;
            Ok((serde_json::json!({"ok": "contract"}), 24_u8))
        },
    )
    .unwrap();

    assert_eq!(contract.response["ok"], "contract");
    assert_eq!(contract.phase, 24);
    assert_eq!(state.usage_totals.tokens_out, 6);
}

#[test]
fn provider_runtime_provider_response_phase_contract_builder_shape() {
    let contract = crate::provider_runtime::provider_response_phase_contract(
        serde_json::json!({"ok": true}),
        3_u8,
    );

    assert_eq!(contract.response["ok"], true);
    assert_eq!(contract.phase, 3);
}

#[test]
fn provider_runtime_provider_response_phase_contract_into_parts_splits_shape() {
    let contract = crate::provider_runtime::provider_response_phase_contract(
        serde_json::json!({"ok": "parts"}),
        8_u8,
    );

    let (response, phase) = crate::provider_runtime::provider_response_phase_contract_into_parts(contract);
    assert_eq!(response["ok"], "parts");
    assert_eq!(phase, 8);
}

#[test]
fn provider_runtime_step_from_state_with_dispatch_passes_arguments() {
    let mut state = crate::provider_runtime::provider_loop_state(Vec::new());
    let phase = 7_u8;
    let response = serde_json::json!({"ok": true});
    let mut dispatch_count = 0_u32;

    let out = crate::provider_runtime::step_from_state_with_dispatch(
        &mut state,
        &phase,
        2,
        5,
        &response,
        &mut dispatch_count,
        |_state, phase, iter_idx, max_iter, response, dispatch| {
            assert_eq!(*phase, 7);
            assert_eq!(iter_idx, 2);
            assert_eq!(max_iter, 5);
            assert_eq!(response["ok"], true);
            *dispatch += 1;
            Ok(Some(format!("done-{dispatch}")))
        },
    )
    .unwrap();

    assert_eq!(out.as_deref(), Some("done-1"));
}

#[test]
fn provider_runtime_step_from_state_with_dispatch_contract_passes_contract_fields() {
    let mut state = crate::provider_runtime::provider_loop_state(Vec::new());
    let phase = 5_u8;
    let response = serde_json::json!({"ok": "contract"});
    let contract = crate::provider_runtime::provider_iteration_contract(&phase, 1, 4, &response);
    let mut dispatch_count = 0_u32;

    let out = crate::provider_runtime::step_from_state_with_dispatch_contract(
        &mut state,
        contract,
        &mut dispatch_count,
        |_state, contract, dispatch| {
            assert_eq!(*contract.phase, 5);
            assert_eq!(contract.iter_idx, 1);
            assert_eq!(contract.max_iter, 4);
            assert_eq!(contract.response["ok"], "contract");
            *dispatch += 1;
            Ok(Some(format!("contract-{dispatch}")))
        },
    )
    .unwrap();

    assert_eq!(out.as_deref(), Some("contract-1"));
}

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

