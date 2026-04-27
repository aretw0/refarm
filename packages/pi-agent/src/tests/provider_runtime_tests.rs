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

#[test]
fn provider_runtime_dispatch_and_dedup_with_passthrough_then_duplicate() {
    let mut seen = std::collections::HashSet::new();

    let first = crate::provider_runtime::dispatch_and_dedup_with(
        "read_file",
        &serde_json::json!({"path":"README.md"}),
        &mut seen,
        |name, input| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );
    let second = crate::provider_runtime::dispatch_and_dedup_with(
        "read_file",
        &serde_json::json!({"path":"README.md"}),
        &mut seen,
        |name, input| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );

    assert_eq!(first, "read_file:README.md");
    assert!(second.contains("duplicate"));
}

#[test]
fn provider_runtime_parse_json_arguments_invalid_falls_back_to_object() {
    let v = crate::provider_runtime::parse_json_arguments("{not-json");
    assert_eq!(v, serde_json::json!({}));
}

#[test]
fn provider_runtime_push_executed_call_appends_schema_shape() {
    let mut calls = Vec::new();
    crate::provider_runtime::push_executed_call(
        &mut calls,
        "read_file",
        serde_json::json!({"path":"README.md"}),
        "ok",
    );

    assert_eq!(calls.len(), 1);
    let entry = &calls[0];
    assert_eq!(entry["name"], "read_file");
    assert_eq!(entry["input"]["path"], "README.md");
    assert_eq!(entry["result"], "ok");
}

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

#[test]
fn provider_runtime_error_message_uses_fallback_when_missing() {
    let v = serde_json::json!({});
    assert_eq!(
        crate::provider_runtime::error_message(&v, "fallback"),
        "fallback"
    );
}

#[test]
fn provider_runtime_error_message_prefers_payload_message() {
    let v = serde_json::json!({"error": {"message": "boom"}});
    assert_eq!(
        crate::provider_runtime::error_message(&v, "fallback"),
        "boom"
    );
}

#[test]
fn provider_runtime_append_anthropic_assistant_message_shape() {
    let mut wire_msgs = Vec::new();
    let blocks = vec![serde_json::json!({"type":"text","text":"hello"})];
    crate::provider_runtime::append_anthropic_assistant_message(&mut wire_msgs, &blocks);

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[0]["content"][0]["text"], "hello");
}

#[test]
fn provider_runtime_append_anthropic_tool_results_message_shape() {
    let mut wire_msgs = Vec::new();
    let tool_results = vec![serde_json::json!({"type":"tool_result","content":"ok"})];
    crate::provider_runtime::append_anthropic_tool_results_message(&mut wire_msgs, tool_results);

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "user");
    assert_eq!(wire_msgs[0]["content"][0]["type"], "tool_result");
}

#[test]
fn provider_runtime_append_openai_assistant_message_shape() {
    let mut wire_msgs = Vec::new();
    let tool_calls = vec![serde_json::json!({"id":"call_1"})];
    crate::provider_runtime::append_openai_assistant_message(
        &mut wire_msgs,
        &serde_json::json!("partial"),
        &tool_calls,
    );

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[0]["content"], "partial");
    assert_eq!(wire_msgs[0]["tool_calls"][0]["id"], "call_1");
}

#[test]
fn provider_runtime_append_openai_tool_message_shape() {
    let mut wire_msgs = Vec::new();
    crate::provider_runtime::append_openai_tool_message(&mut wire_msgs, "call_2", "done".into());

    assert_eq!(wire_msgs.len(), 1);
    assert_eq!(wire_msgs[0]["role"], "tool");
    assert_eq!(wire_msgs[0]["tool_call_id"], "call_2");
    assert_eq!(wire_msgs[0]["content"], "done");
}

#[test]
fn provider_runtime_openai_compat_path_known_overrides() {
    assert_eq!(
        crate::provider_runtime::openai_compat_path("groq"),
        "/openai/v1/chat/completions"
    );
    assert_eq!(
        crate::provider_runtime::openai_compat_path("openrouter"),
        "/api/v1/chat/completions"
    );
    assert_eq!(
        crate::provider_runtime::openai_compat_path("gemini"),
        "/v1beta/openai/chat/completions"
    );
}

#[test]
fn provider_runtime_openai_compat_path_default() {
    assert_eq!(
        crate::provider_runtime::openai_compat_path("unknown"),
        "/v1/chat/completions"
    );
}

#[test]
fn provider_runtime_parse_response_json_reports_error() {
    let err = crate::provider_runtime::parse_response_json(b"{").unwrap_err();
    assert!(err.contains("parse:"));
}

#[test]
fn provider_runtime_build_openai_body_includes_expected_fields() {
    let body = crate::provider_runtime::build_openai_body(
        "m",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([{"type":"function"}]),
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "m");
    assert_eq!(v["max_tokens"], 1024);
    assert_eq!(v["messages"][0]["role"], "user");
    assert_eq!(v["tools"][0]["type"], "function");
}

#[test]
fn provider_runtime_build_anthropic_body_includes_expected_fields() {
    let body = crate::provider_runtime::build_anthropic_body(
        "m2",
        "sys",
        &[serde_json::json!({"role":"user","content":"hi"})],
        serde_json::json!([{"name":"read_file"}]),
    );
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "m2");
    assert_eq!(v["system"], "sys");
    assert_eq!(v["max_tokens"], 1024);
    assert_eq!(v["messages"][0]["role"], "user");
    assert_eq!(v["tools"][0]["name"], "read_file");
}

#[test]
fn provider_runtime_headers_include_content_type() {
    let a = crate::provider_runtime::anthropic_headers();
    let o = crate::provider_runtime::openai_compat_headers();
    assert!(a
        .iter()
        .any(|(k, v)| k == "content-type" && v == "application/json"));
    assert!(o
        .iter()
        .any(|(k, v)| k == "content-type" && v == "application/json"));
}

#[test]
fn provider_runtime_initial_anthropic_wire_messages_maps_history() {
    let msgs = vec![
        ("user".to_string(), "a".to_string()),
        ("assistant".to_string(), "b".to_string()),
    ];
    let wire = crate::provider_runtime::initial_anthropic_wire_messages(&msgs);

    assert_eq!(wire.len(), 2);
    assert_eq!(wire[0]["role"], "user");
    assert_eq!(wire[1]["content"], "b");
}

#[test]
fn provider_runtime_initial_openai_wire_messages_prepends_system() {
    let msgs = vec![("user".to_string(), "hello".to_string())];
    let wire = crate::provider_runtime::initial_openai_wire_messages("sys", &msgs);

    assert_eq!(wire.len(), 2);
    assert_eq!(wire[0]["role"], "system");
    assert_eq!(wire[0]["content"], "sys");
    assert_eq!(wire[1]["role"], "user");
}

#[test]
fn provider_runtime_anthropic_content_array_defaults_to_empty() {
    let v = serde_json::json!({});
    let arr = crate::provider_runtime::anthropic_content_array(&v);
    assert!(arr.is_empty());
}

#[test]
fn provider_runtime_openai_tool_calls_array_defaults_to_empty() {
    let msg = serde_json::json!({});
    let arr = crate::provider_runtime::openai_tool_calls_array(&msg);
    assert!(arr.is_empty());
}

#[test]
fn provider_runtime_parse_anthropic_tool_uses_extracts_fields() {
    let content_arr = vec![
        serde_json::json!({"type":"text","text":"x"}),
        serde_json::json!({"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}),
    ];
    let parsed = crate::provider_runtime::parse_anthropic_tool_uses(&content_arr);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "read_file");
    assert_eq!(parsed[0].input["path"], "README.md");
    assert_eq!(parsed[0].id, "t1");
}

#[test]
fn provider_runtime_anthropic_text_content_prefers_text_block() {
    let content_arr = vec![
        serde_json::json!({"type":"tool_use","name":"x"}),
        serde_json::json!({"type":"text","text":"done"}),
    ];
    assert_eq!(
        crate::provider_runtime::anthropic_text_content(&content_arr).unwrap(),
        "done"
    );
}

#[test]
fn provider_runtime_parse_openai_tool_calls_extracts_fields() {
    let tool_calls = vec![serde_json::json!({
        "id":"call_1",
        "function":{"name":"read_file","arguments":"{\"path\":\"Cargo.toml\"}"}
    })];
    let parsed = crate::provider_runtime::parse_openai_tool_calls(&tool_calls);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "read_file");
    assert_eq!(parsed[0].input["path"], "Cargo.toml");
    assert_eq!(parsed[0].id, "call_1");
}

#[test]
fn provider_runtime_openai_message_content_reads_string() {
    let msg = serde_json::json!({"content":"final"});
    assert_eq!(
        crate::provider_runtime::openai_message_content(&msg).unwrap(),
        "final"
    );
}

#[test]
fn provider_runtime_anthropic_tool_result_shape() {
    let r = crate::provider_runtime::anthropic_tool_result("id-1", "ok".to_string());
    assert_eq!(r["type"], "tool_result");
    assert_eq!(r["tool_use_id"], "id-1");
    assert_eq!(r["content"], "ok");
}

#[test]
fn provider_runtime_require_anthropic_text_content_returns_error_when_missing() {
    let content_arr = vec![serde_json::json!({"type":"tool_use","name":"x"})];
    let response = serde_json::json!({"error": {"message": "boom"}});
    let err = crate::provider_runtime::require_anthropic_text_content(&content_arr, &response)
        .unwrap_err();
    assert_eq!(err, "boom");
}

#[test]
fn provider_runtime_openai_choice_message_reads_first_choice_message() {
    let response = serde_json::json!({
        "choices": [{"message": {"content": "hello"}}]
    });
    let msg = crate::provider_runtime::openai_choice_message(&response);
    assert_eq!(msg["content"], "hello");
}

#[test]
fn provider_runtime_require_openai_message_content_returns_error_when_missing() {
    let msg = serde_json::json!({});
    let response = serde_json::json!({"error": {"message": "nope"}});
    let err = crate::provider_runtime::require_openai_message_content(&msg, &response).unwrap_err();
    assert_eq!(err, "nope");
}

#[test]
fn provider_runtime_record_anthropic_tool_execution_updates_calls_and_result() {
    let mut executed_calls = Vec::new();
    let tool_use = crate::provider_runtime::ParsedAnthropicToolUse {
        name: "read_file".to_string(),
        input: serde_json::json!({"path":"README.md"}),
        id: "t-1".to_string(),
    };

    let result = crate::provider_runtime::record_anthropic_tool_execution(
        &mut executed_calls,
        &tool_use,
        "ok",
    );

    assert_eq!(executed_calls.len(), 1);
    assert_eq!(executed_calls[0]["name"], "read_file");
    assert_eq!(result["tool_use_id"], "t-1");
    assert_eq!(result["content"], "ok");
}

#[test]
fn provider_runtime_record_openai_tool_execution_updates_calls() {
    let mut executed_calls = Vec::new();
    let tool_call = crate::provider_runtime::ParsedOpenAiToolCall {
        name: "search_files".to_string(),
        input: serde_json::json!({"pattern":"TODO"}),
        id: "call-1".to_string(),
    };

    crate::provider_runtime::record_openai_tool_execution(&mut executed_calls, &tool_call, "done");

    assert_eq!(executed_calls.len(), 1);
    assert_eq!(executed_calls[0]["name"], "search_files");
    assert_eq!(executed_calls[0]["input"]["pattern"], "TODO");
    assert_eq!(executed_calls[0]["result"], "done");
}

#[test]
fn provider_runtime_execute_tools_with_maps_results_in_order() {
    let calls = vec!["a", "b"];
    let mut seen_hashes = std::collections::HashSet::new();

    let out = crate::provider_runtime::execute_tools_with(
        &calls,
        &mut seen_hashes,
        |call, _seen| format!("tool-{call}"),
        |call, result| format!("{call}:{result}"),
    );

    assert_eq!(out, vec!["a:tool-a".to_string(), "b:tool-b".to_string()]);
}

#[test]
fn provider_runtime_execute_tools_with_allows_seen_hash_updates() {
    let calls = vec!["same", "same"];
    let mut seen_hashes = std::collections::HashSet::new();

    let out = crate::provider_runtime::execute_tools_with(
        &calls,
        &mut seen_hashes,
        |call, seen| crate::provider_runtime::dedup_tool_output((*call).to_string(), seen),
        |_call, result| result,
    );

    assert_eq!(out.len(), 2);
    assert_eq!(out[0], "same");
    assert!(out[1].contains("duplicate"));
}

#[test]
fn provider_runtime_execute_anthropic_tools_with_dispatches_and_records() {
    let tool_uses = vec![crate::provider_runtime::ParsedAnthropicToolUse {
        name: "read_file".to_string(),
        input: serde_json::json!({"path":"README.md"}),
        id: "tool-1".to_string(),
    }];
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    let results = crate::provider_runtime::execute_anthropic_tools_with(
        &tool_uses,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );

    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["tool_use_id"], "tool-1");
    assert_eq!(results[0]["content"], "read_file:README.md");
    assert_eq!(executed_calls.len(), 1);
    assert_eq!(executed_calls[0]["name"], "read_file");
}

#[test]
fn provider_runtime_execute_openai_tools_with_dispatches_and_records() {
    let parsed_calls = vec![crate::provider_runtime::ParsedOpenAiToolCall {
        name: "search_files".to_string(),
        input: serde_json::json!({"pattern":"TODO"}),
        id: "call-9".to_string(),
    }];
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    let tool_messages = crate::provider_runtime::execute_openai_tools_with(
        &parsed_calls,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["pattern"].as_str().unwrap_or("")),
    );

    assert_eq!(tool_messages.len(), 1);
    assert_eq!(tool_messages[0].id, "call-9");
    assert_eq!(tool_messages[0].content, "search_files:TODO");
    assert_eq!(executed_calls.len(), 1);
    assert_eq!(executed_calls[0]["name"], "search_files");
}

#[test]
fn provider_runtime_append_openai_tool_messages_appends_all() {
    let mut wire_msgs = Vec::new();
    let tool_messages = vec![
        crate::provider_runtime::OpenAiToolMessage {
            id: "call-1".to_string(),
            content: "first".to_string(),
        },
        crate::provider_runtime::OpenAiToolMessage {
            id: "call-2".to_string(),
            content: "second".to_string(),
        },
    ];

    crate::provider_runtime::append_openai_tool_messages(&mut wire_msgs, tool_messages);

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(wire_msgs[0]["tool_call_id"], "call-1");
    assert_eq!(wire_msgs[1]["content"], "second");
}

#[test]
fn provider_runtime_advance_tool_phase_with_runs_append_execute_append_pipeline() {
    let mut wire_msgs = Vec::new();
    let calls = vec![1_u8, 2_u8];
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    crate::provider_runtime::advance_tool_phase_with(
        &mut wire_msgs,
        &calls,
        &mut executed_calls,
        &mut seen_hashes,
        |wire_msgs| wire_msgs.push(serde_json::json!({"role":"assistant"})),
        |calls, executed_calls, _seen| {
            for call in calls {
                executed_calls.push(serde_json::json!({"call": call}));
            }
            vec![serde_json::json!({"count": calls.len()})]
        },
        |wire_msgs, results| {
            wire_msgs.push(serde_json::json!({"role":"tool","results": results}));
        },
    );

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[1]["role"], "tool");
    assert_eq!(wire_msgs[1]["results"][0]["count"], 2);
    assert_eq!(executed_calls.len(), 2);
}

#[test]
fn provider_runtime_advance_anthropic_tool_phase_with_appends_and_records() {
    let mut wire_msgs = Vec::new();
    let content_arr = vec![serde_json::json!({"type":"text","text":"thinking"})];
    let tool_uses = vec![crate::provider_runtime::ParsedAnthropicToolUse {
        name: "read_file".to_string(),
        input: serde_json::json!({"path":"README.md"}),
        id: "tool-1".to_string(),
    }];
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    crate::provider_runtime::advance_anthropic_tool_phase_with(
        &mut wire_msgs,
        &content_arr,
        &tool_uses,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[1]["role"], "user");
    assert_eq!(wire_msgs[1]["content"][0]["tool_use_id"], "tool-1");
    assert_eq!(executed_calls.len(), 1);
}

#[test]
fn provider_runtime_advance_openai_tool_phase_with_appends_and_records() {
    let mut wire_msgs = Vec::new();
    let content = serde_json::json!("partial");
    let tool_calls_json = vec![serde_json::json!({"id":"call-1"})];
    let parsed_calls = vec![crate::provider_runtime::ParsedOpenAiToolCall {
        name: "search_files".to_string(),
        input: serde_json::json!({"pattern":"TODO"}),
        id: "call-1".to_string(),
    }];
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    crate::provider_runtime::advance_openai_tool_phase_with(
        &mut wire_msgs,
        &content,
        &tool_calls_json,
        &parsed_calls,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["pattern"].as_str().unwrap_or("")),
    );

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(wire_msgs[0]["role"], "assistant");
    assert_eq!(wire_msgs[1]["role"], "tool");
    assert_eq!(wire_msgs[1]["tool_call_id"], "call-1");
    assert_eq!(executed_calls.len(), 1);
}

#[test]
fn provider_runtime_anthropic_iteration_phase_extracts_blocks_and_tools() {
    let response = serde_json::json!({
        "content": [
            {"type":"text","text":"hello"},
            {"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}
        ]
    });
    let phase = crate::provider_runtime::anthropic_iteration_phase(&response);

    assert_eq!(phase.content_arr.len(), 2);
    assert_eq!(phase.tool_uses.len(), 1);
    assert!(crate::provider_runtime::anthropic_has_tool_calls(&phase));
}

#[test]
fn provider_runtime_openai_iteration_phase_extracts_message_tools_and_calls() {
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

    assert_eq!(phase.msg["content"], "partial");
    assert_eq!(phase.tool_calls_json.len(), 1);
    assert_eq!(phase.parsed_calls.len(), 1);
    assert!(crate::provider_runtime::openai_has_tool_calls(&phase));
}

#[test]
fn provider_runtime_advance_anthropic_tool_phase_from_phase_with_appends() {
    let response = serde_json::json!({
        "content": [
            {"type":"text","text":"hello"},
            {"type":"tool_use","name":"read_file","input":{"path":"README.md"},"id":"t1"}
        ]
    });
    let phase = crate::provider_runtime::anthropic_iteration_phase(&response);
    let mut wire_msgs = Vec::new();
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    crate::provider_runtime::advance_anthropic_tool_phase_from_phase_with(
        &mut wire_msgs,
        &phase,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["path"].as_str().unwrap_or("")),
    );

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(executed_calls.len(), 1);
}

#[test]
fn provider_runtime_advance_openai_tool_phase_from_phase_with_appends() {
    let response = serde_json::json!({
        "choices": [{
            "message": {
                "content": "partial",
                "tool_calls": [{
                    "id":"call-2",
                    "function":{"name":"search_files","arguments":"{\"pattern\":\"FIXME\"}"}
                }]
            }
        }]
    });
    let phase = crate::provider_runtime::openai_iteration_phase(&response);
    let mut wire_msgs = Vec::new();
    let mut executed_calls = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    crate::provider_runtime::advance_openai_tool_phase_from_phase_with(
        &mut wire_msgs,
        &phase,
        &mut executed_calls,
        &mut seen_hashes,
        |name, input, _| format!("{name}:{}", input["pattern"].as_str().unwrap_or("")),
    );

    assert_eq!(wire_msgs.len(), 2);
    assert_eq!(wire_msgs[1]["tool_call_id"], "call-2");
    assert_eq!(executed_calls.len(), 1);
}

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
