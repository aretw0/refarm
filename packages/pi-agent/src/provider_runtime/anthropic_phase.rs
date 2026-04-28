use super::phase_common::{completion_text_if_terminate, error_message};

pub(crate) fn anthropic_content_array(v: &serde_json::Value) -> Vec<serde_json::Value> {
    v["content"].as_array().cloned().unwrap_or_default()
}

pub(crate) struct ParsedAnthropicToolUse {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) struct AnthropicIterationPhase {
    pub content_arr: Vec<serde_json::Value>,
    pub tool_uses: Vec<ParsedAnthropicToolUse>,
}

pub(crate) fn parse_anthropic_tool_uses(
    content_arr: &[serde_json::Value],
) -> Vec<ParsedAnthropicToolUse> {
    content_arr
        .iter()
        .filter(|c| c["type"] == "tool_use")
        .map(|c| ParsedAnthropicToolUse {
            name: c["name"].as_str().unwrap_or("").to_owned(),
            input: c["input"].clone(),
            id: c["id"].as_str().unwrap_or("").to_owned(),
        })
        .collect()
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

pub(crate) fn anthropic_text_content(content_arr: &[serde_json::Value]) -> Option<String> {
    content_arr
        .iter()
        .find(|c| c["type"] == "text")
        .and_then(|c| c["text"].as_str())
        .map(ToOwned::to_owned)
}

pub(crate) fn require_anthropic_text_content(
    content_arr: &[serde_json::Value],
    response: &serde_json::Value,
) -> Result<String, String> {
    anthropic_text_content(content_arr)
        .ok_or_else(|| error_message(response, "no text in response"))
}
