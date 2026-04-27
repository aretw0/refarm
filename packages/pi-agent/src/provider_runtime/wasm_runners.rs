#[cfg(target_arch = "wasm32")]
use super::{
    anthropic_iteration_response_and_phase, anthropic_runner_config,
    anthropic_step_from_phase_with_dispatch, dispatch_tool_dedup,
    openai_iteration_response_and_phase, openai_runner_config,
    openai_step_from_phase_with_dispatch,
    run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch,
    AnthropicRunnerConfig, OpenAiRunnerConfig, ProviderLoopState, ProviderRunnerCommonConfig,
    UsageTotals,
};

#[cfg(target_arch = "wasm32")]
use super::usage_finalize::finalize_completion_from_outcome;

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

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_anthropic_completion_loop_from_config_with_dispatch<D>(
    config: AnthropicRunnerConfig<'_>,
    dispatch: D,
) -> Result<crate::provider::CompletionResult, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    run_wasm_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        config.common,
        config.system,
        |system, model, headers, wire_msgs, usage_totals| {
            anthropic_iteration_response_and_phase(model, system, wire_msgs, headers, usage_totals)
        },
        anthropic_step_from_phase_with_dispatch,
        dispatch,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_openai_completion_loop_from_config_with_dispatch<D>(
    config: OpenAiRunnerConfig<'_>,
    dispatch: D,
) -> Result<crate::provider::CompletionResult, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    run_wasm_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch(
        config.common,
        (config.provider, config.base_url),
        |&(provider, base_url), model, headers, wire_msgs, usage_totals| {
            openai_iteration_response_and_phase(
                provider,
                base_url,
                model,
                wire_msgs,
                headers,
                usage_totals,
            )
        },
        openai_step_from_phase_with_dispatch,
        dispatch,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_anthropic_completion_loop(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<crate::provider::CompletionResult, String> {
    run_anthropic_completion_loop_with_dispatch(model, system, messages, dispatch_tool_dedup)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_anthropic_completion_loop_with_dispatch<D>(
    model: &str,
    system: &str,
    messages: &[(String, String)],
    dispatch: D,
) -> Result<crate::provider::CompletionResult, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let config = anthropic_runner_config(model, system, messages);
    run_anthropic_completion_loop_from_config_with_dispatch(config, dispatch)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_openai_completion_loop(
    provider: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<crate::provider::CompletionResult, String> {
    run_openai_completion_loop_with_dispatch(
        provider,
        base_url,
        model,
        system,
        messages,
        dispatch_tool_dedup,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_openai_completion_loop_with_dispatch<D>(
    provider: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[(String, String)],
    dispatch: D,
) -> Result<crate::provider::CompletionResult, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let config = openai_runner_config(provider, base_url, model, system, messages);
    run_openai_completion_loop_from_config_with_dispatch(config, dispatch)
}
