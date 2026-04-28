pub(crate) mod agent_tools_bindings;
mod agent_tools_bridge;
mod instance;
mod lsp_bridge;
mod plugin_host;
mod sensitive_aliases;
mod wasi_bridge;

pub use instance::PluginInstanceHandle;
pub use plugin_host::{AgentToolsHandle, PluginHost};
