use super::{
    loop_config::OpenAiRunnerConfig, loop_plan_builders::openai_loop_plan,
    loop_runner_common::provider_runner_common_config, openai_compat_headers,
};

pub(crate) fn openai_runner_config<'a>(
    provider: &'a str,
    base_url: &'a str,
    model: &'a str,
    system: &str,
    messages: &[(String, String)],
) -> OpenAiRunnerConfig<'a> {
    OpenAiRunnerConfig {
        common: provider_runner_common_config(
            model,
            openai_compat_headers(),
            openai_loop_plan(system, messages),
        ),
        provider,
        base_url,
    }
}
