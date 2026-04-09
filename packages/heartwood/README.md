# @refarm.dev/heartwood

Heartwood is Refarm's sovereign cryptographic core, compiled to WebAssembly via the Component Model. It provides Ed25519 signing, SHA-256 hashing, and key derivation primitives — sandboxed, capability-gated, and language-agnostic.

## Usage

```js
import { ... } from "@refarm.dev/heartwood";
```

See `pkg/heartwood.d.ts` for the full API surface.

## The `pkg/` directory

`pkg/` contains the **stable pre-compiled artifacts**: the output of `jco transpile` applied to the compiled WASM binary. These artifacts are committed to the repository and serve as the source of truth for all consumers (CI, downstream packages, `@refarm.dev/tractor`).

```
pkg/
  heartwood.js          # JCO-transpiled JavaScript entry
  heartwood.d.ts        # TypeScript declarations
  heartwood.core.wasm   # Core WASM module
  heartwood.core2.wasm  # Secondary WASM module
  interfaces/           # WIT interface bindings
```

You do **not** need the Rust toolchain to use or publish heartwood — `pkg/` is self-contained.

## Rebuilding

A rebuild compiles Rust → WASM → JCO transpile. It requires:

- [Rust](https://rustup.rs/) stable toolchain
- `wasm32-wasip1` target: `rustup target add wasm32-wasip1`
- `@bytecodealliance/jco` (installed via `npm install`)

```bash
# Full rebuild (Rust compile + JCO transpile)
npm run build

# Only JCO transpile (if WASM binary already exists in target/)
npm run build:transpile
```

## CI

When heartwood's Rust source changes and a rebuild is required, use the reusable workflow:

```yaml
jobs:
  build-heartwood:
    uses: refarm-dev/refarm/.github/workflows/reusable-build-wasm-plugin.yml@main
    with:
      component-name: heartwood
      workspace-path: packages/heartwood
```

## Architecture

Heartwood implements the [Wasm Component Model](https://component-model.bytecodealliance.org/) and is transpiled by [JCO](https://github.com/bytecodealliance/jco) for use in Node.js, browsers, and edge runtimes.

See [`docs/WASM_JCO_ARCHITECTURE.md`](../../docs/WASM_JCO_ARCHITECTURE.md) for the full architectural context.
