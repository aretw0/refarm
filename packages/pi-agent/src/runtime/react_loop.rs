#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
use super::{policy::context_limit_error, types::ReactResult};
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::run_wasm_react;

/// Returns: (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model_id, usage_raw)
pub(crate) fn react(prompt: &str) -> ReactResult {
    if let Some(err) = context_limit_error(prompt) {
        return err;
    }

    #[cfg(target_arch = "wasm32")]
    {
        run_wasm_react(prompt)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        run_native_stub(prompt)
    }
}
