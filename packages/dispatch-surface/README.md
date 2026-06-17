# @refarm.dev/dispatch-surface

Shared primitives for dispatch/control-surface transport handling.

> Note: this package is the TS boundary used by `refarm` and `farmhand`.
> Its behavior is now backed by an optional Wasm/WIT contract from
> `packages/dispatch-surface-rs` when available, with transparent fallback to the
> native TypeScript implementation.

## What it provides

- Task transport parsing (`file`, `http`, `channel:<name>`) with validation.
- Channel transport helpers (`channel:*` resolution and route builders).
- Channel effort payload validation and normalization used by runtime HTTP surface handlers.
- Source/metadata normalization currently mirrors the Rust core contract.
- Canonical channel-capability primitives (`hasChannelControlCapability`,
  `assertChannelControlCapability`, `CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR`)
  for deterministic operation gating.
- Shared universal contract reference: `../../specs/features/dispatch-control-plane-contract.md`.

## Native Rust backend integration

The TypeScript surface will automatically use the Rust-exported Wasm backend when
it is present and can be loaded, unless disabled:

- Set `DISPATCH_SURFACE_USE_RUST=0` to disable native fallback.
- Set `DISPATCH_SURFACE_SKIP_RUST=1` to disable native fallback.

To validate parity, run:

- `pnpm --filter @refarm.dev/dispatch-surface test:parity`

This command compares native-backed and TS-only behavior on representative
inputs.

If you need to (re)build optional Rust/Javascript artifacts used by the
native path:

- `pnpm run dispatch-surface:build-rs`

For a full parity CI-style validation (build + lint/type-check + parity tests):

- `pnpm run dispatch-surface:ci`

If you need a release-like build that requires native artifacts to be present:

- `pnpm run dispatch-surface:build-rs:release`

## Public API

See `src/index.ts` / exported surface.
