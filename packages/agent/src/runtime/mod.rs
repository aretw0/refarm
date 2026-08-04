mod native_stub;
mod policy;
#[cfg(target_arch = "wasm32")]
mod prompt_handler;
#[cfg(target_arch = "wasm32")]
mod prompt_persistence;
mod react_loop;
pub(crate) mod streaming_metadata;
pub(crate) mod streaming_sink;
mod task_labels;
mod types;
#[cfg(target_arch = "wasm32")]
mod wasm_flow;

pub(crate) use react_loop::react;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use react_loop::react_with_prompt_ref;
// The pure `load_skill` payload resolver lives beside the skill index in `policy`;
// re-export it so the wasm `tool_dispatch::skill_tools` wrapper can reach it without
// opening the whole (otherwise-private) `policy` module.
#[cfg(target_arch = "wasm32")]
pub(crate) use policy::resolve_skill_body;
// The cumulative token/spend guards (F6): pure over (spent, limit), so re-exported
// un-gated (native tests exercise them directly) up to crate root, the same path
// `react` takes, so the test module's `use super::*` chain resolves them.
// `RunTotals` (Task 12) rides the same re-export for the same reason: the test
// file's glob-import needs it, even though production code (`react_loop.rs`)
// reaches it directly via `super::policy::RunTotals`, a sibling path this
// re-export is not.
#[allow(unused_imports)]
pub(crate) use policy::{cumulative_limit_error, spend_limit_error, RunTotals};
#[allow(unused_imports)]
pub(crate) use types::ReactResult;

#[cfg(target_arch = "wasm32")]
pub(crate) use prompt_handler::execute_prompt_with_route;
#[cfg(target_arch = "wasm32")]
pub(crate) use prompt_handler::handle_prompt;
