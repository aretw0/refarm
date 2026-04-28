#[cfg(target_arch = "wasm32")]
use super::{
    request_anthropic_response_wasm::anthropic_iteration_response,
    request_flow::iteration_response_and_phase_with, AnthropicIterationPhase, UsageTotals,
};

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
