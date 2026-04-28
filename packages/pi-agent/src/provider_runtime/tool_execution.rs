use super::{
    tool_wire::{anthropic_tool_result, OpenAiToolMessage},
    ParsedAnthropicToolUse, ParsedOpenAiToolCall,
};

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

pub(crate) fn execute_tools_with<T, R, FD, FR>(
    calls: &[T],
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch_for_call: FD,
    mut map_result: FR,
) -> Vec<R>
where
    FD: FnMut(&T, &mut std::collections::HashSet<u64>) -> String,
    FR: FnMut(&T, String) -> R,
{
    let mut out = Vec::with_capacity(calls.len());
    for call in calls {
        let result = dispatch_for_call(call, seen_hashes);
        out.push(map_result(call, result));
    }
    out
}

pub(crate) fn execute_anthropic_tools_with<F>(
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<serde_json::Value>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    execute_tools_with(
        tool_uses,
        seen_hashes,
        |tc, seen| dispatch(&tc.name, &tc.input, seen),
        |tc, result| record_anthropic_tool_execution(executed_calls, tc, &result),
    )
}

pub(crate) fn execute_openai_tools_with<F>(
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<OpenAiToolMessage>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    execute_tools_with(
        parsed_calls,
        seen_hashes,
        |tc, seen| dispatch(&tc.name, &tc.input, seen),
        |tc, result| {
            record_openai_tool_execution(executed_calls, tc, &result);
            OpenAiToolMessage {
                id: tc.id.clone(),
                content: result,
            }
        },
    )
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
