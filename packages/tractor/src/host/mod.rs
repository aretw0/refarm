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
pub use plugin_host::{ConnectionOperatorError, ConnectionOperatorState, HostEffectsHandle, PluginHost};
pub use plugin_registry::{DispatchableVerb, PluginCapabilityProfile, PluginRegistry};
pub use wasi_bridge::{CrossPluginAccess, SelfRespondSpawner};
pub use wasi_variant::{probe_file, WasiVariant};

// The single seam onto the canonical provider→base-URL resolution, for the
// sidecar's read-only provider-liveness probe. Keeps the raw resolver private.
pub(crate) use wasi_bridge::provider_base_url_for_liveness;

// Declared surfaces (S1/S3 — docs/superpowers/specs/2026-07-29-declared-surfaces-design.md).
// `SurfaceDeclaration` and the surface-name constants are `pub` (not `pub(crate)`): the
// `tractor` BINARY (`src/main.rs`) is a separate crate from this library, and it is where
// the declaration is resolved once at boot (`surfaces_from_config`) and threaded into
// `sidecar::start`, so the type has to cross that crate boundary. `sidecar::bind_guard`
// (same crate) reads the struct's fields, which stay `pub(crate)`.
pub use host_effects_bridge::{surfaces_from_config, SurfaceDeclaration, SURFACE_DAEMON_WS, SURFACE_SIDECAR_HTTP};
// `SurfaceExpose`/`SurfaceGate` never appear in a signature main.rs has to name (they are
// only reachable through `SurfaceDeclaration`'s `pub(crate)` fields), but `bind_guard`
// (same crate, different module) still needs to match on them.
pub(crate) use host_effects_bridge::{SurfaceExpose, SurfaceGate};
