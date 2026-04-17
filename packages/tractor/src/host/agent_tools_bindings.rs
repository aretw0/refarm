//! wasmtime bindgen for the agent-tools-host world.
//!
//! Kept in a dedicated file so the two `bindgen!` expansions live in separate
//! Rust modules and never clash on type names (both generate a `refarm` root).
//!
//! Reads `wit/host/agent-tools/world.wit` — separate directory from
//! `wit/host/refarm-plugin-host.wit` to avoid cross-package parse conflicts.

wasmtime::component::bindgen!({
    world: "agent-tools-host",
    path: "wit/host/agent-tools",
    async: true,
});
