#[cfg(target_arch = "wasm32")]
use super::{response_usage, CompletionLoopOutcome, ProviderLoopState};

#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
            + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
            as u32;
    }

    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += usage["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        self.tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result(
    content: String,
    executed_calls: Vec<serde_json::Value>,
    usage: &serde_json::Value,
    totals: UsageTotals,
) -> crate::provider::CompletionResult {
    crate::provider::CompletionResult {
        content,
        tool_calls: serde_json::Value::Array(executed_calls),
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        tokens_cached: totals.tokens_cached,
        tokens_reasoning: totals.tokens_reasoning,
        usage_raw: usage.to_string(),
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result_from_response(
    content: String,
    executed_calls: Vec<serde_json::Value>,
    response: &serde_json::Value,
    totals: UsageTotals,
) -> crate::provider::CompletionResult {
    completion_result(content, executed_calls, response_usage(response), totals)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn finalize_completion_from_response(
    content: String,
    response: &serde_json::Value,
    state: ProviderLoopState,
) -> crate::provider::CompletionResult {
    completion_result_from_response(content, state.executed_calls, response, state.usage_totals)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn finalize_completion_from_outcome(
    outcome: CompletionLoopOutcome,
) -> crate::provider::CompletionResult {
    finalize_completion_from_response(outcome.text, &outcome.response, outcome.state)
}
