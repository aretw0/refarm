# Refarm Courier - Rust Template

This is a template for building a high-performance Courier (HTTP Gateway) plugin for Refarm using Rust and `cargo-component` (WASM 2024 targets).

## Structure

- `src/lib.rs`: The main Courier processor using `wit-bindgen`.
- `Cargo.toml`: Build configuration.

## Building

1. Install `cargo-component`
2. Run `cargo component build --target wasm32-wasi`
