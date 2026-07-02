pub(crate) type ReactResult = (
    String,
    serde_json::Value,
    u32,
    u32,
    u32,
    u32,
    String,
    String,
);

pub(crate) fn blocked_result(message: String) -> ReactResult {
    (
        message,
        serde_json::json!([]),
        0,
        0,
        0,
        0,
        "blocked".to_owned(),
        "{}".to_owned(),
    )
}

pub(crate) fn error_result(message: String, model: String) -> ReactResult {
    (
        message,
        serde_json::json!([]),
        0,
        0,
        0,
        0,
        model,
        "{}".to_owned(),
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result(
    model: String,
    r: crate::provider::CompletionResult,
) -> ReactResult {
    (
        r.content,
        r.tool_calls,
        r.tokens_in,
        r.tokens_out,
        r.tokens_cached,
        r.tokens_reasoning,
        model,
        r.usage_raw,
    )
}
