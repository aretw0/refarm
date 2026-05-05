#[cfg(target_arch = "wasm32")]
use super::{
    anthropic_iteration_response_and_phase, anthropic_runner_config,
    anthropic_step_from_phase_with_dispatch, dispatch_tool_dedup,
    wasm_loop::run_wasm_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch,
    AnthropicRunnerConfig,
};

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
