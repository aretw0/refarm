use super::{AnthropicIterationPhase, OpenAiIterationPhase, UsageTotals};

pub(crate) fn response_usage(response: &serde_json::Value) -> &serde_json::Value {
    &response["usage"]
}

pub(crate) fn ingest_usage_from_response_with<F>(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
    mut ingest: F,
) where
    F: FnMut(&mut UsageTotals, &serde_json::Value),
{
    ingest(totals, response_usage(response));
}

#[cfg(test)]
pub(crate) fn ingest_anthropic_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    ingest_usage_from_response_with(totals, response, UsageTotals::ingest_anthropic_usage);
}

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

#[cfg(test)]
pub(crate) fn ingest_openai_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    ingest_usage_from_response_with(totals, response, UsageTotals::ingest_openai_usage);
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
