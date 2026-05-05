use super::{ProviderLoopState, UsageTotals};

pub(crate) struct ProviderResponsePhaseContract<P> {
    pub response: serde_json::Value,
    pub phase: P,
}

pub(crate) fn provider_response_phase_contract<P>(
    response: serde_json::Value,
    phase: P,
) -> ProviderResponsePhaseContract<P> {
    ProviderResponsePhaseContract { response, phase }
}

pub(crate) fn provider_response_phase_contract_into_parts<P>(
    contract: ProviderResponsePhaseContract<P>,
) -> (serde_json::Value, P) {
    (contract.response, contract.phase)
}

pub(crate) fn response_phase_contract_from_state_with<C, P, FR>(
    context: &C,
    model: &str,
    headers: &[(String, String)],
    state: &mut ProviderLoopState,
    mut response_and_phase_fn: FR,
) -> Result<ProviderResponsePhaseContract<P>, String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &[serde_json::Value],
        &mut UsageTotals,
    ) -> Result<(serde_json::Value, P), String>,
{
    let (response, phase) = response_and_phase_fn(
        context,
        model,
        headers,
        &state.wire_msgs,
        &mut state.usage_totals,
    )?;
    Ok(provider_response_phase_contract(response, phase))
}
