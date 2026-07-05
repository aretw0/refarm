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

## Two components, one core

The dispatch logic lives once in `src/run-core.js` and is shared by TWO
componentize entries (each bundled by esbuild — which inlines `run-core.js` and
keeps `refarm:*` imports external — then compiled by `jco componentize`):

| entry | world | imports | proves |
| --- | --- | --- | --- |
| `src/surface.js` | `vault-surface` | **nothing** | the sandbox-by-absence boundary (`pnpm build:component` → `pkg/`) |
| `src/plugin.js` | `refarm-plugin` | `tractor-bridge` | vault running on the REAL runtime (`pnpm build:plugin` → `pkg-plugin/`) |

### The integration plugin — vault on the real runtime

`src/plugin.js` exports the canonical `integration` interface every refarm plugin
exports, so the tractor host loads and calls it exactly like the agent. The
runtime only calls `setup`/`ingest`/`teardown`/`metadata`/`on-event` (respond/
push/get-help-nodes are dead channels today), so the one live entrypoint is
`on-event`: a caller sends `vault:dispatch` with a JSON payload
`{ verb, note, profile, replyRef? }`; the plugin runs the vault core and, because
`on-event` returns nothing, emits results OUT through the host's `tractor-bridge
store-node` — the exact side channel the agent uses. `loadVaultPluginComponent`
supplies the bridge (a host implementation or a test double).

## Testing

`src/surface.test.ts` drives the sandbox-proof surface (all four verbs + the
empty-import sandbox + the manifest-integrity swap). `src/plugin.test.ts` drives
the integration plugin: `on-event('vault:dispatch', extract)` runs through the
component and stores a KnowledgeRecord via a functional test `tractor-bridge` —
one vault verb through the real runtime contract, no tractor edits. Both **skip**
when their pkg is absent (gitignored, rebuilt by `build:component`/`build:plugin`).
