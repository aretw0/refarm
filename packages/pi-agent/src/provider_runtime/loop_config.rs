use super::UsageTotals;

pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

pub(crate) struct ProviderLoopState {
    pub wire_msgs: Vec<serde_json::Value>,
    pub usage_totals: UsageTotals,
    pub executed_calls: Vec<serde_json::Value>,
    pub seen_hashes: std::collections::HashSet<u64>,
}

pub(crate) struct ProviderLoopPlan {
    pub max_iter: u32,
    pub state: ProviderLoopState,
}

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

pub(crate) fn provider_loop_state(initial_wire_msgs: Vec<serde_json::Value>) -> ProviderLoopState {
    ProviderLoopState {
        wire_msgs: initial_wire_msgs,
        usage_totals: UsageTotals::default(),
        executed_calls: Vec::new(),
        seen_hashes: std::collections::HashSet::new(),
    }
}


