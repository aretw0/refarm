use super::{usage_extract::ingest_usage_from_response_with, UsageTotals};

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
