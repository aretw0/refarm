use super::{CompletionLoopOutcome, ProviderLoopState, ProviderRunnerCommonConfig};

pub(crate) fn run_completion_loop_from_plan_with_dispatch<P, FR, FS, D>(
    plan: super::ProviderLoopPlan,
    response_and_phase: FR,
    mut step_with_dispatch: FS,
    mut dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    super::run_completion_loop_from_plan_with(
        plan,
        response_and_phase,
        |state, phase, iter_idx, max_iter, response| {
            step_with_dispatch(state, phase, iter_idx, max_iter, response, &mut dispatch)
        },
    )
}

pub(crate) fn run_completion_loop_from_common_config_with_dispatch<P, D, FR, FS>(
    common: ProviderRunnerCommonConfig<'_>,
    mut response_and_phase_from_state: FR,
    step_with_dispatch: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &str,
        &[(String, String)],
        &mut ProviderLoopState,
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
    let ProviderRunnerCommonConfig {
        model,
        headers,
        plan,
    } = common;

    run_completion_loop_from_plan_with_dispatch(
        plan,
        |state| response_and_phase_from_state(model, &headers, state),
        step_with_dispatch,
        dispatch,
    )
}

pub(crate) fn run_completion_loop_from_common_config_and_context_with_dispatch<P, C, D, FR, FS>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_and_phase_from_state: FR,
    mut step_with_dispatch: FS,
    dispatch: D,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(
        &C,
        &str,
        &[(String, String)],
        &mut ProviderLoopState,
    ) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &C,
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_from_common_config_with_dispatch(
        common,
        |model, headers, state| response_and_phase_from_state(&context, model, headers, state),
        |state, phase, iter_idx, max_iter, response, dispatch_fn| {
            step_with_dispatch(
                &context,
                state,
                phase,
                iter_idx,
                max_iter,
                response,
                dispatch_fn,
            )
        },
        dispatch,
    )
}
