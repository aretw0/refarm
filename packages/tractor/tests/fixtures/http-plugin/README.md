# http-plugin fixture

A `refarm:http-plugin-fixture` WASM component that exports the canonical
`integration` interface (like every plugin) **and** imports
`wasi:http/outgoing-handler@0.2.3` — an outbound HTTP client.

Its sole purpose is to prove the `network:outbound` grant is a real linker
boundary end-to-end. The host builds two linkers: one WITH wasi:http
(`add_only_http_to_linker_async`) for plugins granted `network:outbound`, and
one WITHOUT (`linker_no_http`) for un-granted plugins. Because this component
imports `outgoing-handler`:

- granted (or dev/Permissive) → links against the http linker → **loads**.
- Strict + grant omitted → links against `linker_no_http` → the
  `outgoing-handler` import cannot resolve → **load errors**.

`null-plugin` cannot prove this (it imports no gated interface, so it loads
identically against either linker). This fixture is the missing e2e proof.

## Why the http import must stay reachable (DCE)

The gated import is only meaningful if it survives dead-code elimination. If
LTO stripped it, the component would import nothing and load fine even without
the grant — silently defeating the test. `on_event` issues a real
`outgoing-handler::handle` call, reachable from the export table, guarded on an
event string that never fires during load (the host resolves imports at
instantiation, before any export runs, so no request is ever sent). Verify the
import is present after any rebuild:

```bash
wasm-tools component wit ../http-plugin.wasm | grep wasi:http/outgoing-handler
```

## What is committed and why (mirrors null-plugin)

- **`../http-plugin.wasm`** — the built component, a **tracked binary**.
  Building a WASM component is not part of a normal `cargo test` run, so the
  artifact is committed and the tests SKIP (no-op) if it is missing rather than
  failing. This is the same convention `null-plugin.wasm` follows.
- **`src/bindings.rs`** — `cargo-component`-generated (DO NOT EDIT); regenerates
  on build. Committed for the same reason `null-plugin/src/bindings.rs` is: the
  source tree stays buildable/inspectable without a bindings-generation step.
- **`#[allow(warnings)] mod bindings;`** in `src/lib.rs` is **not our choice** —
  it is verbatim what `cargo component new` scaffolds. The generated
  `bindings.rs` (~10k lines) trips assorted lints we do not own; silencing them
  at the module boundary is the toolchain's own convention. (`cargo component
  new --lib` emits exactly `#[allow(warnings)] mod bindings;` +
  `bindings::export!(Component with_types_in bindings);`.)

## Toolchain notes (the two gotchas we hit)

- **Version compat.** The host links `wasi:http@0.2.1`
  (`wasmtime-wasi-http-26`); `cargo-component` emits `@0.2.3`. wasmtime does
  **semver-compatible** import matching (`wasmtime-environ-26/src/component/
  names.rs`: registers under an alternate `a:b/c@0.2` key, resolves any
  `@0.2.x` lookup), so a `@0.2.3` import resolves against the `@0.2.1` host
  linker. The version difference does NOT block the fixture.
- **`wit-bindgen-rt`, not `wit-bindgen`.** cargo-component 0.21.x generates
  bindings that call `wit_bindgen_rt::` directly, so the dependency is
  `wit-bindgen-rt` (with the `bitflags` feature), unlike null-plugin's inline
  `wit-bindgen` macro mode.

## WIT layout

The fixture-local world (`wit/fixture-world.wit`, package
`refarm:http-plugin-fixture`) `include`s `refarm:plugin/refarm-plugin` and adds
the `wasi:http/outgoing-handler` import. The `refarm:plugin` dependency is
resolved to the **canonical** WIT directly, NOT vendored: `Cargo.toml`'s
`[package.metadata.component.target.dependencies]` points `refarm:plugin` at
`../../../../plugin-wit/wit`. This is deliberate — ADR-083 mandates a
single source of truth for the plugin WIT, and the `check:wit` guard fails any
tracked `.wit` that declares `package refarm:plugin@` outside the canonical dir.
Only the wasi deps (`wit/deps/{http,io,clocks}/`, distinct packages) are
vendored here, because cargo-component needs their local paths and they are not
part of the refarm canonical package.

## Rebuild

```bash
# from packages/tractor/tests/fixtures/http-plugin
cargo component build --release --target wasm32-wasip1
cp "$(git rev-parse --show-toplevel)/.cache/cargo-target/wasm32-wasip1/release/http_plugin.wasm" ../http-plugin.wasm
wasm-tools component wit ../http-plugin.wasm | grep wasi:http/outgoing-handler  # must print the import
```
