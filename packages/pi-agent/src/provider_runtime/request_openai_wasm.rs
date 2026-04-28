#[cfg(target_arch = "wasm32")]
use super::{
    request_body_openai::build_openai_body, request_flow::iteration_response_and_phase_with,
    request_http_wasm::execute_json_request, request_path::openai_compat_path,
    OpenAiIterationPhase, UsageTotals,
};

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_openai_body(model, wire_msgs, crate::tools_openai());
    execute_json_request(
        provider,
        base_url,
        openai_compat_path(provider),
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response_and_phase(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, OpenAiIterationPhase), String> {
    iteration_response_and_phase_with(
        || openai_iteration_response(provider, base_url, model, wire_msgs, headers),
        usage_totals,
        super::openai_phase_after_usage,
    )
}
