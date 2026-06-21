#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::{run_wasm_react_with_prompt_ref, run_wasm_react_with_prompt_ref_and_route};
use super::{policy::context_limit_error, types::ReactResult};

/// Returns: (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model_id, usage_raw)
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
}
