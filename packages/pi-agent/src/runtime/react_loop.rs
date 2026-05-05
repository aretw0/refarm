#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::run_wasm_react_with_prompt_ref;
use super::{policy::context_limit_error, types::ReactResult};

/// Returns: (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model_id, usage_raw)
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn react(prompt: &str) -> ReactResult {
    react_with_prompt_ref(prompt, None)
}

pub(crate) fn react_with_prompt_ref(prompt: &str, prompt_ref: Option<&str>) -> ReactResult {
    if let Some(err) = context_limit_error(prompt) {
        return err;
    }

    #[cfg(target_arch = "wasm32")]
    {
        run_wasm_react_with_prompt_ref(prompt, prompt_ref)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = prompt_ref;
        run_native_stub(prompt)
    }
}
