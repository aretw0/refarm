use super::{
    tool_wire::{
        anthropic_tool_result, append_anthropic_assistant_message,
        append_anthropic_tool_results_message, append_openai_assistant_message,
        append_openai_tool_messages, OpenAiToolMessage,
    },
    AnthropicIterationPhase, OpenAiIterationPhase, ParsedAnthropicToolUse, ParsedOpenAiToolCall,
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

pub(crate) fn advance_tool_phase_with<TC, TR, FA, FE, FR>(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_calls: &[TC],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut append_assistant: FA,
    mut execute_tools: FE,
    mut append_results: FR,
) where
    FA: FnMut(&mut Vec<serde_json::Value>),
    FE: FnMut(&[TC], &mut Vec<serde_json::Value>, &mut std::collections::HashSet<u64>) -> TR,
    FR: FnMut(&mut Vec<serde_json::Value>, TR),
{
    append_assistant(wire_msgs);
    let results = execute_tools(tool_calls, executed_calls, seen_hashes);
    append_results(wire_msgs, results);
}

pub(crate) fn advance_anthropic_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &AnthropicIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_anthropic_tool_phase_with(
        wire_msgs,
        &phase.content_arr,
        &phase.tool_uses,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_openai_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &OpenAiIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_openai_tool_phase_with(
        wire_msgs,
        &phase.msg["content"],
        &phase.tool_calls_json,
        &phase.parsed_calls,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_anthropic_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    advance_tool_phase_with(
        wire_msgs,
        tool_uses,
        executed_calls,
        seen_hashes,
        |wire_msgs| append_anthropic_assistant_message(wire_msgs, content_arr),
        |tool_uses, executed_calls, seen_hashes| {
            execute_anthropic_tools_with(
                tool_uses,
                executed_calls,
                seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            )
        },
        append_anthropic_tool_results_message,
    );
}

pub(crate) fn advance_openai_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    advance_tool_phase_with(
        wire_msgs,
        parsed_calls,
        executed_calls,
        seen_hashes,
        |wire_msgs| append_openai_assistant_message(wire_msgs, content, tool_calls_json),
        |parsed_calls, executed_calls, seen_hashes| {
            execute_openai_tools_with(
                parsed_calls,
                executed_calls,
                seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            )
        },
        append_openai_tool_messages,
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

