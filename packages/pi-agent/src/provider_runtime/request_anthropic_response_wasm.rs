#[cfg(target_arch = "wasm32")]
use super::{
    request_body_anthropic::build_anthropic_body_with_streaming,
    request_http_wasm::execute_json_request_with_streaming_callback,
};

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_anthropic_body_with_streaming(
        model,
        system,
        wire_msgs,
        crate::tools_anthropic(),
        crate::streaming_config::provider_stream_request_enabled_from_env(),
    );
    execute_json_request_with_streaming_callback(
        "anthropic",
        "https://api.anthropic.com",
        "/v1/messages",
        headers,
        &body,
        |_| {},
    )
}
