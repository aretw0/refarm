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
    let bytes =
        crate::provider::http_post_via_host(provider, base_url, path, headers, body.as_bytes())?;
    if crate::streaming_config::provider_stream_request_enabled_from_env() {
        on_stream_bytes(&bytes);
    }
    parse_response_json(&bytes)
}
