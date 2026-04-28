use super::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    response_phase_contract_from_state_with, step_from_state_with_dispatch_contract,
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

pub(crate) fn step_from_state_with_dispatch<P, D, FS>(
    state: &mut ProviderLoopState,
    phase: &P,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: &mut D,
    mut step_fn: FS,
) -> Result<Option<String>, String>
where
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    step_from_state_with_dispatch_contract(
        state,
        provider_iteration_contract(phase, iter_idx, max_iter, response),
        dispatch,
        |state, contract, dispatch| {
            step_fn(
                state,
                contract.phase,
                contract.iter_idx,
                contract.max_iter,
                contract.response,
                dispatch,
            )
        },
    )
}
