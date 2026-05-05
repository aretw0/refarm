use super::{
    tool_execution::execute_openai_tools_with,
    tool_phase_common::advance_tool_phase_with,
    tool_wire::{append_openai_assistant_message, append_openai_tool_messages},
    OpenAiIterationPhase, ParsedOpenAiToolCall,
};

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
