use super::{
    anthropic_headers, loop_plan_builders::anthropic_loop_plan,
    loop_runner_common::provider_runner_common_config, loop_runner_types::AnthropicRunnerConfig,
};

pub(crate) fn anthropic_runner_config<'a>(
    model: &'a str,
    system: &'a str,
    messages: &[(String, String)],
) -> AnthropicRunnerConfig<'a> {
    AnthropicRunnerConfig {
        common: provider_runner_common_config(
            model,
            anthropic_headers(),
            anthropic_loop_plan(messages),
        ),
        system,
    }
}
