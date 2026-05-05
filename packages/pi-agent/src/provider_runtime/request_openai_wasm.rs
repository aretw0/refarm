#[cfg(target_arch = "wasm32")]
use super::{
    request_iteration::iteration_response_and_phase_with,
    request_openai_response_wasm::openai_iteration_response, OpenAiIterationPhase, UsageTotals,
};
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
