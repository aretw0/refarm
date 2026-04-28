#[cfg(target_arch = "wasm32")]
use super::{
    dispatch_tool_dedup, openai_iteration_response_and_phase, openai_runner_config,
    openai_step_from_phase_with_dispatch,
    wasm_loop::run_wasm_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch,
    OpenAiRunnerConfig,
};

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
