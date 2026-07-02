use super::phase_common::error_message;

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
