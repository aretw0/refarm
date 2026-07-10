use super::{
    anthropic_text::anthropic_text_content,
    anthropic_tool_uses::{
        anthropic_content_array, parse_anthropic_tool_uses, ParsedAnthropicToolUse,
    },
    phase_common::resolve_termination_text,
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
    // Kept to match the loop's terminate-fn signature; no longer read (a no-text
    // cutoff is handled gracefully, not as a response error).
    _response: &serde_json::Value,
) -> Result<Option<String>, String> {
    // No text at a forced cutoff is NOT an error — resolve_termination_text
    // synthesizes a graceful final. So pass the OPTIONAL text, never a required Result.
    Ok(resolve_termination_text(
        anthropic_has_tool_calls(phase),
        iter_idx,
        max_iter,
        anthropic_text_content(&phase.content_arr),
    ))
}
