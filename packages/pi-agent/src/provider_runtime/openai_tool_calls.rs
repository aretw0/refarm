use super::phase_common::parse_json_arguments;

pub(crate) fn openai_tool_calls_array(msg: &serde_json::Value) -> Vec<serde_json::Value> {
    msg["tool_calls"].as_array().cloned().unwrap_or_default()
}

pub(crate) struct ParsedOpenAiToolCall {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
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
