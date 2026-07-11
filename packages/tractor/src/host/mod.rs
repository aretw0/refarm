pub(crate) mod host_effects_bindings;
mod host_effects_bridge;
mod instance;
mod lsp_bridge;
pub(crate) mod permission;
mod plugin_host;
pub(crate) mod plugin_registry;
pub(crate) mod self_dispatch;
mod sensitive_aliases;
mod wasi_bridge;
pub mod wasi_variant;

pub use instance::{PluginInstanceHandle, DEFAULT_ON_EVENT_BUDGET_MS};
pub use plugin_host::{HostEffectsHandle, PluginHost};
pub use plugin_registry::{DispatchableVerb, PluginCapabilityProfile, PluginRegistry};
pub use wasi_bridge::{CrossPluginAccess, SelfRespondSpawner};
pub use wasi_variant::{probe_file, WasiVariant};

// The single seam onto the canonical provider→base-URL resolution, for the
// sidecar's read-only provider-liveness probe. Keeps the raw resolver private.
pub(crate) use wasi_bridge::provider_base_url_for_liveness;
