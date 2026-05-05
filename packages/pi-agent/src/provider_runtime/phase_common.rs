pub(crate) fn parse_json_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}

pub(crate) fn should_terminate_tool_loop(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
) -> bool {
    !has_tool_calls || iter_idx == max_iter
}

pub(crate) fn completion_text_if_terminate(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
    content: Result<String, String>,
) -> Result<Option<String>, String> {
    if should_terminate_tool_loop(has_tool_calls, iter_idx, max_iter) {
        content.map(Some)
    } else {
        Ok(None)
    }
}

pub(crate) fn error_message(v: &serde_json::Value, fallback: &str) -> String {
    v["error"]["message"]
        .as_str()
        .unwrap_or(fallback)
        .to_owned()
}
