use super::{CompletionLoopOutcome, ProviderLoopState, ProviderRunnerCommonConfig};

pub(crate) fn run_completion_loop_from_common_config_and_context_with_dispatch<P, C, D, FR, FS>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    mut response_and_phase_from_state: FR,
    mut step_with_dispatch: FS,
    mut dispatch: D,
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
    let ProviderRunnerCommonConfig {
        model,
        headers,
        plan,
    } = common;

    super::run_completion_loop_from_plan_with(
        plan,
        |state| response_and_phase_from_state(&context, model, &headers, state),
        |state, phase, iter_idx, max_iter, response| {
            step_with_dispatch(
                &context,
                state,
                phase,
                iter_idx,
                max_iter,
                response,
                &mut dispatch,
            )
        },
    )
}
