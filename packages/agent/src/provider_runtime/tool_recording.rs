use super::{tool_wire::anthropic_tool_result, ParsedAnthropicToolUse, ParsedOpenAiToolCall};

pub(crate) fn record_anthropic_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_use: &ParsedAnthropicToolUse,
    result: &str,
) -> serde_json::Value {
    push_executed_call(
        executed_calls,
        &tool_use.name,
        tool_use.input.clone(),
        result,
    );
    anthropic_tool_result(&tool_use.id, result.to_owned())
}

pub(crate) fn record_openai_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_call: &ParsedOpenAiToolCall,
    result: &str,
) {
    push_executed_call(
        executed_calls,
        &tool_call.name,
        tool_call.input.clone(),
        result,
    );
}

pub(crate) fn push_executed_call(
    executed_calls: &mut Vec<serde_json::Value>,
    name: &str,
    input: serde_json::Value,
    result: &str,
) {
    executed_calls.push(serde_json::json!({
        "name": name,
        "input": input,
        "result": result,
    }));
}
