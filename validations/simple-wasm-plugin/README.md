# Simple WASM Plugin

Minimal Rust-based WASM plugin for testing JCO Component Model integration with Refarm Tractor.

## Purpose

This plugin serves as:
- **Compilation validation**: Confirms wit-bindgen correctly generates Component Model bindings
- **JCO integration test**: Used by `packages/tractor/test/jco-integration.test.ts`
- **Reference implementation**: Template for other Rust-based plugins

## Build

Requires:
- Rust 1.70+ with `wasm32-unknown-unknown` target
- `wit-bindgen = "0.21"` crate

```bash
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/refarm_simple_wasm_plugin.wasm` (~9.8 KB)

## Exported Functions

Implements `refarm:plugin` world interface:

- `setup() -> Result<(), string>` — Initialize plugin
- `ingest() -> Result<u32, string>` — Fetch and normalize data
- `push(payload: string) -> Result<(), string>` — Push updates to external service
- `teardown()` — Cleanup resources
- `get_help_nodes() -> Result<Vec<string>, string>` — Return help metadata as JSON-LD
- `metadata() -> PluginMetadata` — Return plugin name, version, description
- `on_event(event: string, payload: Option<string>)` — Handle system events

## Current Status

**cdylib** (raw WASM library). To become a full Component Model component, it needs:

1. **Linking**: `wit-component componentNew(cdylib, wit-interface) -> component`
2. **Transpilation**: `jco.transpile(component) -> JS bindings + WASM stubs`
3. **Instantiation**: `WebAssembly.instantiate(component, imports)`

This linking step will be implemented in the future `plugin-compiler` package.

## Common Issues

### `warning: struct 'Plugin' is never constructed`

**Expected behavior** when using wit-bindgen's trait pattern. The struct is never instantiated directly; `wit_bindgen::generate!()` creates glue code that calls trait methods. This warning is suppressed with `#[allow(dead_code)]`.

**For plugin users**: You will never see this warning. It's specific to plugin compilation.

## Testing

Used by `packages/tractor/test/jco-integration.test.ts` to validate:
1. JCO library availability
2. WASM compilation success
3. Component metadata extraction
4. WIT-to-Rust binding generation

Tests pass: ✅ 7/7 (including full tractor suite: 65/65)
