use super::{
    anthropic_text::require_anthropic_text_content,
    anthropic_tool_uses::{
        anthropic_content_array, parse_anthropic_tool_uses, ParsedAnthropicToolUse,
    },
    phase_common::completion_text_if_terminate,
};

pub(crate) struct AnthropicIterationPhase {
    pub content_arr: Vec<serde_json::Value>,
    pub tool_uses: Vec<ParsedAnthropicToolUse>,
}

pub(crate) fn anthropic_iteration_phase(response: &serde_json::Value) -> AnthropicIterationPhase {
    let content_arr = anthropic_content_array(response);
    let tool_uses = parse_anthropic_tool_uses(&content_arr);
    AnthropicIterationPhase {
        content_arr,
        tool_uses,
    }
}

pub(crate) fn anthropic_has_tool_calls(phase: &AnthropicIterationPhase) -> bool {
    !phase.tool_uses.is_empty()
}

pub(crate) fn anthropic_completion_text_if_terminate(
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
) -> Result<Option<String>, String> {
    completion_text_if_terminate(
        anthropic_has_tool_calls(phase),
        iter_idx,
        max_iter,
        require_anthropic_text_content(&phase.content_arr, response),
    )
}

