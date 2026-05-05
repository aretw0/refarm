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
