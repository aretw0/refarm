use super::{
    response_phase_contract_from_state_with,
    run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch,
    CompletionLoopOutcome, ProviderLoopState, ProviderRunnerCommonConfig, UsageTotals,
};

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
