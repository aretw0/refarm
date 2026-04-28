use super::{
    usage_phase_common::phase_after_usage_with, AnthropicIterationPhase, OpenAiIterationPhase,
    UsageTotals,
};

pub(crate) fn anthropic_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> AnthropicIterationPhase {
    phase_after_usage_with(
        totals,
        response,
        UsageTotals::ingest_anthropic_usage,
        super::anthropic_iteration_phase,
    )
}

pub(crate) fn openai_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> OpenAiIterationPhase {
    phase_after_usage_with(
        totals,
        response,
        UsageTotals::ingest_openai_usage,
        super::openai_iteration_phase,
    )
}
