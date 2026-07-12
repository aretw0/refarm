#[allow(dead_code)]
pub(crate) fn build_openai_body(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    build_openai_body_with_streaming(model, wire_msgs, tools, false)
}

pub(crate) fn build_openai_body_with_streaming(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    stream: bool,
) -> String {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": super::loop_limits::max_output_tokens(),
        "tools": tools,
        "messages": wire_msgs,
    });
    if stream {
        body["stream"] = serde_json::Value::Bool(true);
    }
    body.to_string()
}

pub(crate) fn build_openai_codex_responses_body_with_streaming(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
    _stream: bool,
) -> String {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for message in wire_msgs {
        let role = message["role"].as_str().unwrap_or("user");
        let content = message["content"].as_str().unwrap_or("");
        match role {
            // System messages become top-level `instructions` (the Responses API has no
            // system role in `input`).
            "system" => {
                if !content.is_empty() {
                    instructions.push(content.to_string());
                }
            }
            // A tool RESULT: chat wire uses `{role:"tool", tool_call_id, content}`, but the
            // Responses API rejects `role:"tool"` — it models a result as a standalone
            // `function_call_output` item keyed by `call_id`. Translate it.
            "tool" => {
                let call_id = message["tool_call_id"].as_str().unwrap_or("");
                input.push(serde_json::json!({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": content,
                }));
            }
            // An assistant turn that CALLED tools: chat wire carries them under
            // `tool_calls`; the Responses API wants one `function_call` item each (plus the
            // assistant text as a message, if any). A plain assistant/user turn passes
            // through as `{role, content}`.
            _ => {
                if let Some(tool_calls) = message["tool_calls"].as_array() {
                    if !content.is_empty() {
                        input.push(serde_json::json!({ "role": role, "content": content }));
                    }
                    for call in tool_calls {
                        let function = &call["function"];
                        input.push(serde_json::json!({
                            "type": "function_call",
                            "call_id": call["id"].as_str().unwrap_or(""),
                            "name": function["name"].as_str().unwrap_or(""),
                            "arguments": function["arguments"].as_str().unwrap_or("{}"),
                        }));
                    }
                } else {
                    input.push(serde_json::json!({ "role": role, "content": content }));
                }
            }
        }
    }
    // NOTE: the openai-codex subscription endpoint (e.g. gpt-5.3-codex-spark on the
    // Responses API) REJECTS `max_output_tokens` with HTTP 400 "Unsupported parameter:
    // max_output_tokens" — unlike the standard OpenAI Responses API. The output cap is
    // governed subscription-side, so we simply omit it here; the runtime's own loop limits
    // still bound the turn. (The non-codex OpenAI chat body above keeps `max_tokens`.)
    let mut body = serde_json::json!({
        "model": model,
        "store": false,
        "stream": true,
        "input": input,
        "tools": openai_chat_tools_to_responses_tools(tools),
    });
    if !instructions.is_empty() {
        body["instructions"] = serde_json::Value::String(instructions.join("\n\n"));
    }
    body.to_string()
}

fn openai_chat_tools_to_responses_tools(tools: serde_json::Value) -> serde_json::Value {
    let Some(items) = tools.as_array() else {
        return serde_json::Value::Array(Vec::new());
    };
    serde_json::Value::Array(
        items
            .iter()
            .filter_map(|tool| {
                let function = tool.get("function")?;
                Some(serde_json::json!({
                    "type": "function",
                    "name": function.get("name").cloned().unwrap_or_default(),
                    "description": function.get("description").cloned().unwrap_or_default(),
                    "parameters": function.get("parameters").cloned().unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}})),
                }))
            })
            .collect(),
    )
}

#[cfg(test)]
mod codex_responses_body_tests {
    use super::*;

    fn body_of(wire: &[serde_json::Value]) -> serde_json::Value {
        let s =
            build_openai_codex_responses_body_with_streaming("gpt-x", wire, serde_json::json!([]), true);
        serde_json::from_str(&s).expect("valid json")
    }

    #[test]
    fn omits_max_output_tokens_the_codex_endpoint_rejects() {
        let body = body_of(&[serde_json::json!({"role":"user","content":"hi"})]);
        assert!(
            body.get("max_output_tokens").is_none(),
            "codex Responses body must not send max_output_tokens (HTTP 400)"
        );
    }

    #[test]
    fn system_message_becomes_instructions_not_input() {
        let body = body_of(&[
            serde_json::json!({"role":"system","content":"be terse"}),
            serde_json::json!({"role":"user","content":"hi"}),
        ]);
        assert_eq!(body["instructions"], "be terse");
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 1, "only the user turn goes to input");
        assert_eq!(input[0]["role"], "user");
    }

    #[test]
    fn tool_result_role_becomes_function_call_output() {
        // The chat wire `{role:"tool", tool_call_id, content}` — which the Responses API
        // rejects with "Invalid value: 'tool'" — must translate to a function_call_output.
        let body = body_of(&[
            serde_json::json!({"role":"user","content":"do it"}),
            serde_json::json!({
                "role":"assistant","content":"",
                "tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":1}"}}]
            }),
            serde_json::json!({"role":"tool","tool_call_id":"call_1","content":"result-text"}),
        ]);
        let input = body["input"].as_array().unwrap();
        // No item may carry role "tool".
        assert!(
            input.iter().all(|i| i["role"] != "tool"),
            "no input item may use role:tool"
        );
        // The assistant's tool call → a function_call item with the same call_id.
        let call = input
            .iter()
            .find(|i| i["type"] == "function_call")
            .expect("a function_call item");
        assert_eq!(call["call_id"], "call_1");
        assert_eq!(call["name"], "lookup");
        assert_eq!(call["arguments"], "{\"q\":1}");
        // The tool result → a function_call_output keyed by the same call_id.
        let out = input
            .iter()
            .find(|i| i["type"] == "function_call_output")
            .expect("a function_call_output item");
        assert_eq!(out["call_id"], "call_1");
        assert_eq!(out["output"], "result-text");
    }

    #[test]
    fn plain_user_and_assistant_turns_pass_through() {
        let body = body_of(&[
            serde_json::json!({"role":"user","content":"q"}),
            serde_json::json!({"role":"assistant","content":"a"}),
        ]);
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 2);
        assert_eq!(input[0], serde_json::json!({"role":"user","content":"q"}));
        assert_eq!(input[1], serde_json::json!({"role":"assistant","content":"a"}));
    }
}
