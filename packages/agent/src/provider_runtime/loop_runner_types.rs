use super::loop_config::ProviderLoopPlan;

pub(crate) struct ProviderRunnerCommonConfig<'a> {
    pub model: &'a str,
    pub headers: Vec<(String, String)>,
    pub plan: ProviderLoopPlan,
}

pub(crate) struct AnthropicRunnerConfig<'a> {
    pub common: ProviderRunnerCommonConfig<'a>,
    pub system: &'a str,
}

pub(crate) struct OpenAiRunnerConfig<'a> {
    pub common: ProviderRunnerCommonConfig<'a>,
    pub provider: &'a str,
    pub base_url: &'a str,
}
