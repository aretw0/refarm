#[cfg(target_arch = "wasm32")]
use super::{
    request_builders::build_anthropic_body, request_flow::iteration_response_and_phase_with,
    request_wasm::execute_json_request, AnthropicIterationPhase, UsageTotals,
};

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_anthropic_body(model, system, wire_msgs, crate::tools_anthropic());
    execute_json_request(
        "anthropic",
        "https://api.anthropic.com",
        "/v1/messages",
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response_and_phase(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, AnthropicIterationPhase), String> {
    iteration_response_and_phase_with(
        || anthropic_iteration_response(model, system, wire_msgs, headers),
        usage_totals,
        super::anthropic_phase_after_usage,
    )
}
