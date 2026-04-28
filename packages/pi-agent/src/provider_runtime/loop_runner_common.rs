use super::{loop_config::ProviderLoopPlan, loop_runner_types::ProviderRunnerCommonConfig};

pub(crate) fn provider_runner_common_config<'a>(
    model: &'a str,
    headers: Vec<(String, String)>,
    plan: ProviderLoopPlan,
) -> ProviderRunnerCommonConfig<'a> {
    ProviderRunnerCommonConfig {
        model,
        headers,
        plan,
    }
}
