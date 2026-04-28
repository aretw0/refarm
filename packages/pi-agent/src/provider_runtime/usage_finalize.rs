#[cfg(target_arch = "wasm32")]
use super::{response_usage, CompletionLoopOutcome, ProviderLoopState, UsageTotals};

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
