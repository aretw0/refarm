# @refarm.dev/vault-surface-ref

The reference **vault:v1 surface** — a pure-compute WASM component (world
`vault-surface`) built **from TypeScript via `componentize-js`**, proving the
sovereign vault plugin boundary end to end. The first non-agent WASM plugin, and
the first TS→WASM component in the repo.

## The chain

```
src/surface.js  ──jco componentize──▶  dist/vault_surface.wasm  ──jco transpile──▶  pkg/
   (TS entry,        --disable all           (a component that            (loadable glue +
   pure compute)   = sandbox by absence      imports NOTHING)              core .wasm)
```

`pnpm build:component` runs the whole chain. `src/surface.js` implements the
`vault-surface` world's `run(verb, note, profile)` — the same behavior as
`@refarm.dev/vault-contract-v1`'s reference surface, ported dependency-free so it
runs inside StarlingMonkey (no node imports, no clock, no filesystem).

## The sandbox is the ABSENCE of imports

Built with `--disable all`, the component's `ImportObject` is `{}` — it imports
**nothing** (no `wasi:filesystem`, no clock, no env). The host-side loader
(`src/index.ts`) instantiates it with an **empty** capability table and `run()`
still returns. A vault surface cannot touch the filesystem or network because
there is no import through which to try — a stronger boundary than deny-all stubs.
`loadVaultSurfaceComponent(pkgDir)` loads ANY `vault-surface` component the same
sovereign way, so a plugin-contributed surface runs under the same absence.

## §8 install

The component's real SHA-256 is what completes the plugin manifest: the
foundation manifest (`buildVaultPluginManifest`) is deliberately invalid until an
`integrity` is stamped, and `src/surface.test.ts` proves the swap — hashing the
built `.wasm` and asserting `validatePluginManifest` then passes. That is exactly
what a real install performs.

## Testing

`src/surface.test.ts` drives the REAL transpiled component (all four verbs +
the empty-import sandbox proof + the manifest-integrity swap). It **skips** when
`pkg/` is absent — run `pnpm build:component` first (the output is gitignored and
rebuilt). CI builds the component before the test.
