use super::{
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch,
    CompletionLoopOutcome, ProviderIterationContract, ProviderLoopState,
    ProviderResponsePhaseContract, ProviderRunnerCommonConfig,
};

pub(crate) fn run_completion_loop_from_common_config_and_context_with_contract_primitives<
    P,
    C,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_phase_contract_fn: FR,
    mut step_contract_fn: FS,
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
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_with_contract_primitives(
        common,
        |model, headers, state| response_phase_contract_fn(&context, model, headers, state),
        |state, contract| step_contract_fn(&context, state, contract),
    )
}

pub(crate) fn run_completion_loop_from_common_config_with_contract_primitives<P, FR, FS>(
    common: ProviderRunnerCommonConfig<'_>,
    response_phase_contract_fn: FR,
    mut step_contract_fn: FS,
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
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch(
        common,
        response_phase_contract_fn,
        |state, contract, _unit_dispatch: &mut ()| step_contract_fn(state, contract),
        (),
    )
}
