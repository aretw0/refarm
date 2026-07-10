use super::{
    openai_message::{openai_choice_message, openai_message_content},
    openai_tool_calls::{openai_tool_calls_array, parse_openai_tool_calls, ParsedOpenAiToolCall},
    phase_common::resolve_termination_text,
};

pub(crate) struct OpenAiIterationPhase {
    pub msg: serde_json::Value,
    pub tool_calls_json: Vec<serde_json::Value>,
    pub parsed_calls: Vec<ParsedOpenAiToolCall>,
}

pub(crate) fn openai_iteration_phase(response: &serde_json::Value) -> OpenAiIterationPhase {
    let msg = openai_choice_message(response).clone();
    let tool_calls_json = openai_tool_calls_array(&msg);
    let parsed_calls = parse_openai_tool_calls(&tool_calls_json);
    OpenAiIterationPhase {
        msg,
        tool_calls_json,
        parsed_calls,
    }
}

pub(crate) fn openai_has_tool_calls(phase: &OpenAiIterationPhase) -> bool {
    !phase.tool_calls_json.is_empty()
}

pub(crate) fn openai_completion_text_if_terminate(
    phase: &OpenAiIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    // Kept to match the loop's terminate-fn signature; no longer read (a no-text
    // cutoff is handled gracefully, not as a response error).
    _response: &serde_json::Value,
) -> Result<Option<String>, String> {
    Ok(resolve_termination_text(
        openai_has_tool_calls(phase),
        iter_idx,
        max_iter,
        openai_message_content(&phase.msg),
    ))
}
