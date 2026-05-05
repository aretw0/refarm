use super::UsageTotals;

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
