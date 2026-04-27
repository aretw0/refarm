use super::{
    response_phase_contract_from_state_with,
    run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch,
    CompletionLoopOutcome, ProviderLoopState, ProviderRunnerCommonConfig, UsageTotals,
};

#[cfg(test)]
use super::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    run_completion_loop_from_common_config_and_context_with_contract_primitives,
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch,
    step_from_state_with_dispatch_contract,
};

#[cfg(test)]
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

#[cfg(test)]
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

pub(crate) fn run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch<
    P,
    C,
    D,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_and_phase_fn: FR,
    mut step_fn: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &[serde_json::Value],
        &mut UsageTotals,
    ) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch(
        common,
        context,
        |context, model, headers, state| {
            response_phase_contract_from_state_with(
                context,
                model,
                headers,
                state,
                |context, model, headers, wire_msgs, usage_totals| {
                    response_and_phase_fn(context, model, headers, wire_msgs, usage_totals)
                },
            )
        },
        |_context, state, contract, dispatch_fn| {
            step_fn(
                state,
                contract.phase,
                contract.iter_idx,
                contract.max_iter,
                contract.response,
                dispatch_fn,
            )
        },
        dispatch,
    )
}

#[cfg(test)]
pub(crate) fn run_completion_loop_from_common_config_with_state_primitives_and_dispatch<
    P,
    D,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    mut response_and_phase_fn: FR,
    mut step_fn: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &str,
        &[(String, String)],
        &[serde_json::Value],
        &mut UsageTotals,
    ) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch(
        common,
        |model, headers, state| {
            response_phase_contract_from_state_with(
                &(),
                model,
                headers,
                state,
                |_unit, model, headers, wire_msgs, usage_totals| {
                    response_and_phase_fn(model, headers, wire_msgs, usage_totals)
                },
            )
        },
        |state, contract, dispatch_fn| {
            step_fn(
                state,
                contract.phase,
                contract.iter_idx,
                contract.max_iter,
                contract.response,
                dispatch_fn,
            )
        },
        dispatch,
    )
}

#[cfg(test)]
pub(crate) fn run_completion_loop_from_common_config_and_context_with_state_primitives<
    P,
    C,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_and_phase_fn: FR,
    mut step_fn: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &[serde_json::Value],
        &mut UsageTotals,
    ) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_and_context_with_contract_primitives(
        common,
        context,
        |context, model, headers, state| {
            response_phase_contract_from_state_with(
                context,
                model,
                headers,
                state,
                |context, model, headers, wire_msgs, usage_totals| {
                    response_and_phase_fn(context, model, headers, wire_msgs, usage_totals)
                },
            )
        },
        |_context, state, contract| {
            step_fn(
                state,
                contract.phase,
                contract.iter_idx,
                contract.max_iter,
                contract.response,
            )
        },
    )
}
