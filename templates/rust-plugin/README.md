# Refarm Rust Plugin Template

This is a minimal template for building Refarm integration plugins in Rust.

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [cargo-component](https://github.com/bytecodealliance/cargo-component)

## Building

```bash
cargo component build --release
```

The resulting WASM component will be in `target/wasm32-wasi/release/rust_plugin_template.wasm`.

## Integration

Refarm plugins implement the `refarm:plugin/refarm-plugin` world defined in `wit/refarm-sdk.wit`.

All outside world interactions (storage, network, logs) must go through the `tractor-bridge` imports.
