use super::{
    usage_extract::ingest_usage_from_response_with, AnthropicIterationPhase, OpenAiIterationPhase,
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

pub(crate) fn phase_after_usage_with<P, FU, FP>(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
    ingest_usage: FU,
    mut phase_from_response: FP,
) -> P
where
    FU: FnMut(&mut UsageTotals, &serde_json::Value),
    FP: FnMut(&serde_json::Value) -> P,
{
    ingest_usage_from_response_with(totals, response, ingest_usage);
    phase_from_response(response)
}
