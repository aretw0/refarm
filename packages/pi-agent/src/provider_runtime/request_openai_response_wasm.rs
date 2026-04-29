#[cfg(target_arch = "wasm32")]
use super::{
    request_body_openai::build_openai_body_with_streaming, request_http_wasm::execute_json_request,
    request_path::openai_compat_path,
};

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_openai_body_with_streaming(
        model,
        wire_msgs,
        crate::tools_openai(),
        crate::streaming_config::provider_stream_request_enabled_from_env(),
    );
    execute_json_request(
        provider,
        base_url,
        openai_compat_path(provider),
        headers,
        &body,
    )
}
