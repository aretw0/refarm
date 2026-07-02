use super::{
    tool_execution::execute_anthropic_tools_with,
    tool_phase_common::advance_tool_phase_with,
    tool_wire::{append_anthropic_assistant_message, append_anthropic_tool_results_message},
    AnthropicIterationPhase, ParsedAnthropicToolUse,
};

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
