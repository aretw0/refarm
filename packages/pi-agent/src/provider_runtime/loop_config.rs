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

#[cfg(any(test, target_arch = "wasm32"))]
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

pub(crate) fn provider_loop_state(initial_wire_msgs: Vec<serde_json::Value>) -> ProviderLoopState {
    ProviderLoopState {
        wire_msgs: initial_wire_msgs,
        usage_totals: UsageTotals::default(),
        executed_calls: Vec::new(),
        seen_hashes: std::collections::HashSet::new(),
    }
}

#[cfg(test)]
pub(crate) fn provider_loop_plan_with_max_iter(
    initial_wire_msgs: Vec<serde_json::Value>,
    max_iter: u32,
) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter,
        state: provider_loop_state(initial_wire_msgs),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_loop_state(messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(super::initial_anthropic_wire_messages(messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_loop_plan(messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: anthropic_loop_state(messages),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_loop_state(system: &str, messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(super::initial_openai_wire_messages(system, messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_loop_plan(system: &str, messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: openai_loop_state(system, messages),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_runner_config<'a>(
    model: &'a str,
    system: &'a str,
    messages: &[(String, String)],
) -> AnthropicRunnerConfig<'a> {
    AnthropicRunnerConfig {
        common: provider_runner_common_config(
            model,
            super::anthropic_headers(),
            anthropic_loop_plan(messages),
        ),
        system,
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
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
            super::openai_compat_headers(),
            openai_loop_plan(system, messages),
        ),
        provider,
        base_url,
    }
}
