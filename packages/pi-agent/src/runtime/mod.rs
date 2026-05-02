mod native_stub;
mod policy;
#[cfg(target_arch = "wasm32")]
mod prompt_handler;
#[cfg(target_arch = "wasm32")]
mod prompt_persistence;
mod react_loop;
pub(crate) mod streaming_sink;
mod types;
#[cfg(target_arch = "wasm32")]
mod wasm_flow;

pub(crate) use react_loop::react;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use react_loop::react_with_prompt_ref;
#[allow(unused_imports)]
pub(crate) use types::ReactResult;

#[cfg(target_arch = "wasm32")]
pub(crate) use prompt_handler::execute_prompt;
#[cfg(target_arch = "wasm32")]
pub(crate) use prompt_handler::handle_prompt;
