mod react_loop;

pub(crate) use react_loop::react;

#[cfg(target_arch = "wasm32")]
mod prompt_handler;

#[cfg(target_arch = "wasm32")]
pub(crate) use prompt_handler::handle_prompt;
