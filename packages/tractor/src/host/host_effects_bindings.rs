//! wasmtime bindgen for the host-effects-host world.
//!
//! Kept in a dedicated file so the two `bindgen!` expansions live in separate
//! Rust modules and never clash on type names (both generate a `refarm` root).
//!
//! Reads `wit/host/host-effects/world.wit` — separate directory from
//! the `host-plugin` world in `../plugin-wit/wit` to avoid cross-package parse conflicts.

wasmtime::component::bindgen!({
    world: "host-effects-host",
    path: "wit/host/host-effects",
    async: true,
});
