#[cfg(target_arch = "wasm32")]
use super::{
    run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch,
    usage_finalize::finalize_completion_from_outcome, ProviderLoopState,
    ProviderRunnerCommonConfig, UsageTotals,
};

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_wasm_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch<
    P,
    C,
    D,
    FR,
    FS,
>(
    common: ProviderRunnerCommonConfig<'_>,
    context: C,
    response_and_phase_fn: FR,
    step_fn: FS,
    dispatch: D,
) -> Result<crate::provider::CompletionResult, String>
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
    let outcome =
        run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
            common,
            context,
            response_and_phase_fn,
            step_fn,
            dispatch,
        )?;
    Ok(finalize_completion_from_outcome(outcome))
}
