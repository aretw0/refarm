use super::UsageTotals;

pub(crate) fn ingest_anthropic_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    super::ingest_usage_from_response_with(totals, response, UsageTotals::ingest_anthropic_usage);
}

pub(crate) fn ingest_openai_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    super::ingest_usage_from_response_with(totals, response, UsageTotals::ingest_openai_usage);
}
