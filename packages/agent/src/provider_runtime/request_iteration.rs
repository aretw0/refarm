use super::UsageTotals;

pub(crate) fn iteration_response_and_phase_with<P, FR, FP>(
    mut response_fn: FR,
    usage_totals: &mut UsageTotals,
    mut phase_after_usage_fn: FP,
) -> Result<(serde_json::Value, P), String>
where
    FR: FnMut() -> Result<serde_json::Value, String>,
    FP: FnMut(&mut UsageTotals, &serde_json::Value) -> P,
{
    let response = response_fn()?;
    let phase = phase_after_usage_fn(usage_totals, &response);
    Ok((response, phase))
}
