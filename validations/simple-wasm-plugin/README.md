# Simple WASM Plugin

Minimal Rust-based WASM plugin for testing JCO Component Model integration with Refarm Tractor.

## Build

Requires:
- Rust with `wasm32-unknown-unknown` target
- `wit-bindgen` crate

```bash
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/refarm_simple_wasm_plugin.wasm`

## Functions

- `setup()` - Lifecycle initialization hook
- `greet(name: string) -> string` - Echo with prefix
- `echo(message: string) -> string` - Passthrough
- `add(a: i32, b: i32) -> i32` - Numeric operation
- `on_event(event: string)` - Event handler
- `get_help_nodes() -> string` - Return help metadata as JSON-LD

## Testing

Used by `packages/tractor/test/jco-integration.test.ts` to validate:
1. WASM fetch and instantiation
2. Function export discovery
3. Argument marshalling
4. Return value handling
