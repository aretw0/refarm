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
