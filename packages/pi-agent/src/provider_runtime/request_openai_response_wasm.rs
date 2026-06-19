#[cfg(target_arch = "wasm32")]
use super::{
    openai_message::normalize_openai_codex_response,
    request_body_openai::{
        build_openai_body_with_streaming, build_openai_codex_responses_body_with_streaming,
    },
    request_http_wasm::execute_json_request_with_streaming_callback,
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
    let stream = crate::streaming_config::provider_stream_request_enabled_from_env();
    let body = if provider == "openai-codex" {
        build_openai_codex_responses_body_with_streaming(
            model,
            wire_msgs,
            crate::tools_openai(),
            stream,
        )
    } else {
        build_openai_body_with_streaming(model, wire_msgs, crate::tools_openai(), stream)
    };
    let response = execute_json_request_with_streaming_callback(
        provider,
        base_url,
        openai_compat_path(provider),
        headers,
        &body,
        crate::runtime::streaming_sink::record_stream_bytes_for_active_sink,
    )?;
    Ok(if provider == "openai-codex" {
        normalize_openai_codex_response(response)
    } else {
        response
    })
}
