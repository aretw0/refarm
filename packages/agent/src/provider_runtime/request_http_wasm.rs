#[cfg(target_arch = "wasm32")]
use super::request_parse::parse_response_json;

#[cfg(target_arch = "wasm32")]
#[allow(dead_code)]
pub(crate) fn execute_json_request(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &str,
) -> Result<serde_json::Value, String> {
    let bytes =
        crate::provider::http_post_via_host(provider, base_url, path, headers, body.as_bytes())?;
    parse_response_json(&bytes)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn execute_json_request_with_streaming_callback(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &str,
    mut on_stream_bytes: impl FnMut(&[u8]),
) -> Result<serde_json::Value, String> {
    if crate::streaming_config::provider_stream_request_enabled_from_env() {
        if let Some(metadata) = crate::runtime::streaming_sink::active_stream_response_metadata() {
            let response = crate::provider::http_post_stream_via_host(
                provider,
                base_url,
                path,
                headers,
                body.as_bytes(),
                crate::provider::HostStreamRequestMetadata {
                    prompt_ref: &metadata.prompt_ref,
                    model: &metadata.model,
                    provider_family: provider,
                    last_sequence: metadata.last_sequence,
                },
            )?;
            crate::runtime::streaming_sink::record_host_stream_result_for_active_sink(
                response.last_sequence,
            );
            if response.stored_chunks == 0 {
                on_stream_bytes(&response.final_body);
            }
            return parse_response_json(&response.final_body);
        }
    }

    let bytes =
        crate::provider::http_post_via_host(provider, base_url, path, headers, body.as_bytes())?;
    if crate::streaming_config::provider_stream_request_enabled_from_env() {
        on_stream_bytes(&bytes);
    }
    parse_response_json(&bytes)
}
