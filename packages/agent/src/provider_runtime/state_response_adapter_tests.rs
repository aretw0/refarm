use super::{
    provider_response_phase_contract_into_parts, response_phase_contract_from_state_with,
    ProviderLoopState, UsageTotals,
};

pub(crate) fn response_and_phase_from_state_with<C, P, FR>(
    context: &C,
    model: &str,
    headers: &[(String, String)],
    state: &mut ProviderLoopState,
    mut response_and_phase_fn: FR,
) -> Result<(serde_json::Value, P), String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &[serde_json::Value],
        &mut UsageTotals,
    ) -> Result<(serde_json::Value, P), String>,
{
    let contract = response_phase_contract_from_state_with(
        context,
        model,
        headers,
        state,
        |context, model, headers, wire_msgs, usage_totals| {
            response_and_phase_fn(context, model, headers, wire_msgs, usage_totals)
        },
    )?;
    Ok(provider_response_phase_contract_into_parts(contract))
}
