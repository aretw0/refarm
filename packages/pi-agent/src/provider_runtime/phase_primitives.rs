use super::phase_common::{completion_text_if_terminate, error_message, parse_json_arguments};

pub(crate) fn openai_tool_calls_array(msg: &serde_json::Value) -> Vec<serde_json::Value> {
    msg["tool_calls"].as_array().cloned().unwrap_or_default()
}

pub(crate) struct ParsedOpenAiToolCall {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) struct OpenAiIterationPhase {
    pub msg: serde_json::Value,
    pub tool_calls_json: Vec<serde_json::Value>,
    pub parsed_calls: Vec<ParsedOpenAiToolCall>,
}

pub(crate) fn parse_openai_tool_calls(
    tool_calls_json: &[serde_json::Value],
) -> Vec<ParsedOpenAiToolCall> {
    tool_calls_json
        .iter()
        .map(|tc| {
            let fn_obj = &tc["function"];
            ParsedOpenAiToolCall {
                name: fn_obj["name"].as_str().unwrap_or("").to_owned(),
                input: parse_json_arguments(fn_obj["arguments"].as_str().unwrap_or("{}")),
                id: tc["id"].as_str().unwrap_or("").to_owned(),
            }
        })
        .collect()
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
    response: &serde_json::Value,
) -> Result<Option<String>, String> {
    completion_text_if_terminate(
        openai_has_tool_calls(phase),
        iter_idx,
        max_iter,
        require_openai_message_content(&phase.msg, response),
    )
}

pub(crate) fn openai_message_content(msg: &serde_json::Value) -> Option<String> {
    msg["content"].as_str().map(ToOwned::to_owned)
}

pub(crate) fn openai_choice_message(response: &serde_json::Value) -> &serde_json::Value {
    &response["choices"][0]["message"]
}

pub(crate) fn require_openai_message_content(
    msg: &serde_json::Value,
    response: &serde_json::Value,
) -> Result<String, String> {
    openai_message_content(msg).ok_or_else(|| error_message(response, "no content"))
}
