use super::phase_common::error_message;

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
