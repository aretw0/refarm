#[cfg(not(target_arch = "wasm32"))]
use super::types::{error_result, ReactResult};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn run_native_stub(prompt: &str) -> ReactResult {
    error_result(format!("[pi-agent stub] {prompt}"), "stub".to_owned())
}
