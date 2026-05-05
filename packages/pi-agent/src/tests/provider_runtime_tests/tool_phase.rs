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

