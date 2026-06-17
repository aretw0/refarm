# @refarm.dev/dispatch-surface (Rust Core)

> Canonical, runtime-agnostic Rust implementation of dispatch/control-plane transport primitives.

This crate focuses on shared business logic that can be used natively and in WASM surfaces:

- Transport parsing (`file`, `http`, `channel:<name>`)
- Channel transport resolution
- Channel effort payload validation (`direction`, `tasks`)
- Channel effort normalization (`source`, `context`, `traceIds`, `replyTo`)
- Channel-effort effort/route builders

The crate also exposes a WIT interface (`wit/dispatch-surface.wit`) and is component-buildable.

A future JS/TS façade can consume the Wasm component and keep external APIs
stable while sharing the same behavior.

### JS façade artifacts

- Build Wasm component and emit transpile artifacts:
  `node scripts/build-dispatch-surface-rs.mjs`
- Directly build component:
  `cargo component build --release`
- Direct transpile with jco (when available):
  `jco transpile <artifact>.wasm -o packages/dispatch-surface-rs/pkg --name dispatch_surface --import-bindings hybrid`

The generated `pkg` is optional and used as a runtime enhancement by
`@refarm.dev/dispatch-surface`; if absent, the package falls back to the
TypeScript implementation.

## Distribution policy

The `pkg/` and `dist/` outputs are runtime/build artifacts and are intentionally **not** committed as source truth.

### Runtime policy by target

- **Source-only workspace checkout (TS/CI/dev):** optional native fallback is enabled when `pkg/dispatch_surface.js` exists and is loadable.
- **Native build environments:** run `pnpm run dispatch-surface:build-rs` (or `pnpm run dispatch-surface:build-rs:release` for strict jco-required mode) to refresh `dist/` + `pkg/` before parity/type-check gates.
- **Node/browser consumers:** the optional native path is best-effort (fallback to pure TS if `pkg/` is absent).

### Release policy (next-step)

For publish-time parity validation, the release pipeline should:

1. Rebuild `dist/`/`pkg/` from source via `dispatch-surface:build-rs` in a pinned environment.
2. Keep release artifacts focused on semantic source + checksums; consumers get native speed by rebuilding in their CI, not via committed generated runtime binaries.

For package consumers, stable API and contract expectations are represented by:

- `@refarm.dev/dispatch-surface` public API (`src/index.ts`)
- `wit/dispatch-surface.wit` and Rust tests in this crate
- Cross-runtime parity checks (`test:parity`)

## Crate Layout

- `src/lib.rs`: exported public API + WIT guest export implementation
- `wit/dispatch-surface.wit`: canonical component interface contract
- `tests`: unit tests for transport parsing and payload normalization

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md).
