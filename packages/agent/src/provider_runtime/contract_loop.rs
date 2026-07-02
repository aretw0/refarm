use super::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    step_from_state_with_dispatch_contract, CompletionLoopOutcome, ProviderIterationContract,
    ProviderLoopState, ProviderResponsePhaseContract, ProviderRunnerCommonConfig,
};

pub(crate) fn run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch<
    P,
    C,
    D,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_phase_contract_fn: FR,
    mut step_contract_fn: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &mut ProviderLoopState,
    ) -> Result<ProviderResponsePhaseContract<P>, String>,
    FS: FnMut(
        &C,
        &mut ProviderLoopState,
        ProviderIterationContract<'_, P>,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch(
        common,
        |model, headers, state| response_phase_contract_fn(&context, model, headers, state),
        |state, contract, dispatch_fn| step_contract_fn(&context, state, contract, dispatch_fn),
        dispatch,
    )
}

pub(crate) fn run_completion_loop_from_common_config_with_contract_primitives_and_dispatch<
    P,
    D,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    mut response_phase_contract_fn: FR,
    mut step_contract_fn: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &str,
        &[(String, String)],
        &mut ProviderLoopState,
    ) -> Result<ProviderResponsePhaseContract<P>, String>,
    FS: FnMut(
        &mut ProviderLoopState,
        ProviderIterationContract<'_, P>,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    super::run_completion_loop_from_common_config_and_context_with_dispatch(
        common,
        (),
        |_unit, model, headers, state| {
            let contract = response_phase_contract_fn(model, headers, state)?;
            Ok(provider_response_phase_contract_into_parts(contract))
        },
        |_unit, state, phase, iter_idx, max_iter, response, dispatch_fn| {
            step_from_state_with_dispatch_contract(
                state,
                provider_iteration_contract(phase, iter_idx, max_iter, response),
                dispatch_fn,
                |state, contract, dispatch_fn| step_contract_fn(state, contract, dispatch_fn),
            )
        },
        dispatch,
    )
}
