#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::{run_wasm_react_with_prompt_ref, run_wasm_react_with_prompt_ref_and_route};
use super::{
    policy::{context_limit_error, cumulative_limit_error, spend_limit_error},
    types::ReactResult,
};

/// Returns: (content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw)
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn react(prompt: &str) -> ReactResult {
    react_with_prompt_ref(prompt, None)
}

pub(crate) fn react_with_prompt_ref(prompt: &str, prompt_ref: Option<&str>) -> ReactResult {
    react_with_prompt_ref_and_route(prompt, prompt_ref, None, None)
}

pub(crate) fn react_with_prompt_ref_and_route(
    prompt: &str,
    prompt_ref: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
) -> ReactResult {
    if let Some(err) = context_limit_error(prompt) {
        return err;
    }

    let result: ReactResult = {
        #[cfg(target_arch = "wasm32")]
        {
            match (provider, model) {
                (None, None) => run_wasm_react_with_prompt_ref(prompt, prompt_ref),
                _ => run_wasm_react_with_prompt_ref_and_route(prompt, prompt_ref, provider, model),
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (prompt_ref, provider, model);
            run_native_stub(prompt)
        }
    };

    // The turn's usage is now known — fold it into the running spend and check
    // both ceilings before handing the result back. Token check first (Step 5,
    // resolution #2): tokens are exact, the USD estimate is a rate-table guess
    // that can go stale, so the more reliable guard reports the stop when both
    // would fire. Task 5's resolved ceiling is not threaded into the agent yet
    // (it lives on the sidecar side) — None here keeps both guards structurally
    // inert, changing nothing for an existing run, until that wiring lands.
    let (content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw) =
        result;
    let spent_tokens = tokens_in.saturating_add(tokens_out);
    if let Some(err) = cumulative_limit_error(spent_tokens, None) {
        return err;
    }
    let provider_name = provider
        .map(str::to_owned)
        .unwrap_or_else(crate::provider_name_from_env);
    let spent_usd = crate::estimate_billable_usd(
        &provider_name,
        &model_id,
        tokens_in,
        tokens_out,
        cache_read_tokens,
        cache_creation_tokens,
    );
    if let Some(err) = spend_limit_error(&provider_name, spent_usd, None) {
        return err;
    }

    (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        cache_read_tokens,
        cache_creation_tokens,
        tokens_reasoning,
        model_id,
        usage_raw,
    )
}
