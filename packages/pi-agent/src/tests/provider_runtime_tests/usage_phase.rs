#[test]
fn provider_runtime_usage_totals_ingest_anthropic_fields() {
    let usage = serde_json::json!({
        "input_tokens": 10,
        "output_tokens": 4,
        "cache_read_input_tokens": 3,
        "cache_creation_input_tokens": 2
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    totals.ingest_anthropic_usage(&usage);

    assert_eq!(totals.tokens_in, 10);
    assert_eq!(totals.tokens_out, 4);
    assert_eq!(totals.tokens_cached, 5);
    assert_eq!(totals.tokens_reasoning, 0);
}

#[test]
fn provider_runtime_usage_totals_ingest_openai_fields() {
    let usage = serde_json::json!({
        "prompt_tokens": 12,
        "completion_tokens": 6,
        "prompt_tokens_details": {"cached_tokens": 7},
        "completion_tokens_details": {"reasoning_tokens": 2}
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    totals.ingest_openai_usage(&usage);

    assert_eq!(totals.tokens_in, 12);
    assert_eq!(totals.tokens_out, 6);
    assert_eq!(totals.tokens_cached, 7);
    assert_eq!(totals.tokens_reasoning, 2);
}

#[test]
fn provider_runtime_response_usage_returns_usage_object() {
    let response = serde_json::json!({"usage": {"prompt_tokens": 9}});
    assert_eq!(
        crate::provider_runtime::response_usage(&response)["prompt_tokens"],
        9
    );
}

#[test]
fn provider_runtime_ingest_usage_from_response_with_uses_usage_payload() {
    let response = serde_json::json!({
        "usage": {
            "prompt_tokens": 4,
            "completion_tokens": 3,
            "prompt_tokens_details": {"cached_tokens": 1},
            "completion_tokens_details": {"reasoning_tokens": 2}
        }
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();

    crate::provider_runtime::ingest_usage_from_response_with(
        &mut totals,
        &response,
        crate::provider_runtime::UsageTotals::ingest_openai_usage,
    );

    assert_eq!(totals.tokens_in, 4);
    assert_eq!(totals.tokens_out, 3);
    assert_eq!(totals.tokens_cached, 1);
    assert_eq!(totals.tokens_reasoning, 2);
}

#[test]
fn provider_runtime_phase_after_usage_with_runs_ingest_then_phase() {
    let response = serde_json::json!({
        "usage": {
            "prompt_tokens": 5,
            "completion_tokens": 2,
            "prompt_tokens_details": {"cached_tokens": 1},
            "completion_tokens_details": {"reasoning_tokens": 0}
        },
        "marker": "ok"
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();

    let phase = crate::provider_runtime::phase_after_usage_with(
        &mut totals,
        &response,
        crate::provider_runtime::UsageTotals::ingest_openai_usage,
        |r| r["marker"].as_str().unwrap_or("").to_string(),
    );

    assert_eq!(phase, "ok");
    assert_eq!(totals.tokens_in, 5);
    assert_eq!(totals.tokens_out, 2);
}

#[test]
fn provider_runtime_iteration_response_and_phase_with_returns_both() {
    let mut totals = crate::provider_runtime::UsageTotals::default();

    let (response, phase) = crate::provider_runtime::iteration_response_and_phase_with(
        || Ok(serde_json::json!({"usage":{"input_tokens":3,"output_tokens":1},"v":7})),
        &mut totals,
        crate::provider_runtime::anthropic_phase_after_usage,
    )
    .unwrap();

    assert_eq!(response["v"], 7);
    assert_eq!(phase.content_arr.len(), 0);
    assert_eq!(totals.tokens_in, 3);
    assert_eq!(totals.tokens_out, 1);
}

#[test]
fn provider_runtime_ingest_anthropic_usage_from_response() {
    let response = serde_json::json!({
        "usage": {
            "input_tokens": 3,
            "output_tokens": 2,
            "cache_read_input_tokens": 1,
            "cache_creation_input_tokens": 4
        }
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    crate::provider_runtime::ingest_anthropic_usage_from_response(&mut totals, &response);

    assert_eq!(totals.tokens_in, 3);
    assert_eq!(totals.tokens_out, 2);
    assert_eq!(totals.tokens_cached, 5);
}

#[test]
fn provider_runtime_ingest_openai_usage_from_response() {
    let response = serde_json::json!({
        "usage": {
            "prompt_tokens": 5,
            "completion_tokens": 7,
            "prompt_tokens_details": {"cached_tokens": 2},
            "completion_tokens_details": {"reasoning_tokens": 1}
        }
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    crate::provider_runtime::ingest_openai_usage_from_response(&mut totals, &response);

    assert_eq!(totals.tokens_in, 5);
    assert_eq!(totals.tokens_out, 7);
    assert_eq!(totals.tokens_cached, 2);
    assert_eq!(totals.tokens_reasoning, 1);
}

#[test]
fn provider_runtime_anthropic_phase_after_usage_updates_totals_and_extracts_phase() {
    let response = serde_json::json!({
        "usage": {
            "input_tokens": 3,
            "output_tokens": 2,
            "cache_read_input_tokens": 1,
            "cache_creation_input_tokens": 4
        },
        "content": [
            {"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}
        ]
    });
    let mut totals = crate::provider_runtime::UsageTotals::default();
    let phase = crate::provider_runtime::anthropic_phase_after_usage(&mut totals, &response);

    assert_eq!(totals.tokens_in, 3);
    assert_eq!(phase.tool_uses.len(), 1);
}

#[test]
fn provider_runtime_openai_phase_after_usage_updates_totals_and_extracts_phase() {
    let response = serde_json::json!({
        "usage": {
            "prompt_tokens": 5,
            "completion_tokens": 7,
            "prompt_tokens_details": {"cached_tokens": 2},
            "completion_tokens_details": {"reasoning_tokens": 1}
        },
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
    let mut totals = crate::provider_runtime::UsageTotals::default();
    let phase = crate::provider_runtime::openai_phase_after_usage(&mut totals, &response);

    assert_eq!(totals.tokens_in, 5);
    assert_eq!(phase.parsed_calls.len(), 1);
}

