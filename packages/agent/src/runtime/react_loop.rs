#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::{run_wasm_react_with_prompt_ref, run_wasm_react_with_prompt_ref_and_route};
use super::{
    policy::{context_limit_error, cumulative_limit_error, spend_limit_error, RunTotals},
    types::ReactResult,
};

std::thread_local! {
    // Cumulative usage across every turn THIS LOADED AGENT INSTANCE has
    // processed. `PluginInstanceHandle::call_on_event` (the tractor host) drives
    // one already-loaded plugin's on_event calls through the SAME wasmtime
    // `Store` — and therefore the same guest linear memory — across every event
    // it ever receives (the agent's `concurrentSafe` manifest flag defaults
    // false: one Store serially processes every turn, never a pool of N). So
    // this thread-local persists across separate calls into this function, the
    // same substrate `agent_events`'s `ACTIVE_PROMPT_REF` and
    // `streaming_sink`'s `ACTIVE_STREAM_RESPONSE_SINK` already rely on. Unlike
    // those two, which are OVERWRITTEN every call (they carry "the current
    // one"), this one is deliberately never reset — accumulating across turns
    // is the entire point of F6.
    static RUN_TOTALS: std::cell::RefCell<RunTotals> =
        std::cell::RefCell::new(RunTotals::default());
}

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

    // The turn's usage is now known — fold it into the RUN's running totals
    // (not just this turn's) and check both ceilings before handing the result
    // back. Token check first (Step 5, resolution #2): tokens are exact, the
    // USD estimate is a rate-table guess that can go stale, so the more
    // reliable guard reports the stop when both would fire. The ceilings
    // themselves ride two env vars `handle_prompt` sets from the per-effort
    // payload the sidecar builds (Task 5's resolved budget) — absent env means
    // absent declaration anywhere in the fold, so an installation that
    // declares nothing reads `None` here exactly as it always has.
    let (content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw) =
        result;
    let token_limit = std::env::var("MODEL_RUN_MAX_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok());
    let cumulative_tokens = RUN_TOTALS.with(|run| {
        let mut run = run.borrow_mut();
        run.add_turn(tokens_in, tokens_out);
        run.total()
    });
    if let Some(err) = cumulative_limit_error(cumulative_tokens, token_limit) {
        return err;
    }
    let provider_name = provider
        .map(str::to_owned)
        .unwrap_or_else(crate::provider_name_from_env);
    let turn_spend_usd = crate::estimate_billable_usd(
        &provider_name,
        &model_id,
        tokens_in,
        tokens_out,
        cache_read_tokens,
        cache_creation_tokens,
    );
    let usd_limit = std::env::var("MODEL_RUN_MAX_USD")
        .ok()
        .and_then(|v| v.parse::<f64>().ok());
    let cumulative_usd = RUN_TOTALS.with(|run| {
        let mut run = run.borrow_mut();
        run.add_spend_usd(turn_spend_usd);
        run.total_usd()
    });
    if let Some(err) = spend_limit_error(&provider_name, cumulative_usd, usd_limit) {
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
