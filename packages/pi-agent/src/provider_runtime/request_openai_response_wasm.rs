#[cfg(target_arch = "wasm32")]
use super::{
    openai_message::normalize_openai_codex_response,
    request_body_openai::{
        build_openai_body_with_streaming, build_openai_codex_responses_body_with_streaming,
    },
    request_http_wasm::execute_json_request_with_streaming_callback,
    request_path::openai_compat_path,
    stream_events::parse_openai_codex_response_from_sse,
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
    Ok(if provider == "openai-codex" {
        let bytes = crate::provider::http_post_via_host(
            provider,
            base_url,
            openai_compat_path(provider),
            headers,
            body.as_bytes(),
        )?;
        normalize_openai_codex_response(parse_openai_codex_response_from_sse(&bytes)?)
    } else {
        execute_json_request_with_streaming_callback(
            provider,
            base_url,
            openai_compat_path(provider),
            headers,
            &body,
            crate::runtime::streaming_sink::record_stream_bytes_for_active_sink,
        )?
    })
}
