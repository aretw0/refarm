# `vault:v1` — the first real (non-agent) WASM plugin candidate

**Status:** **TS-only foundation COMPLETE** — 4 atomic slices (`3cc68301` contract+reference+conformance+WIT, `949d5ed8` emit, `48662456` dispatch, `ae2a4276` manifest); 28 tests; lint/type-check/build/check:wit/validate-packages clean. Grounded by recon workflow `wf_510a0ee6` (4 agents, source-verified). Only the WASM component + host dispatch remain — a downstream `§8` slice, now reduced to a rehearsed, minimal handoff.

## Why this exists — the cross-POC pattern

Recon of the POC vaults (rcdc5 / `digital-gardening-kit`, and job-vault) found they are the **same kind of block** — PARA-structured markdown knowledge vaults — and both independently need the **same four generic verbs** over a vault:

| verb       | what it does                                                          |
| ---------- | -------------------------------------------------------------------- |
| `search`   | query notes by tag/state/type/frontmatter/text                       |
| `extract`  | parse a note into structured records (`KnowledgeRecord`)             |
| `organize` | resolve destination folder + canonical filename from a routing rule  |
| `profile`  | run pluggable classifiers/quality checks over notes                  |

**The hole:** `source-contract-v1`'s `SourceProvider` is deliberately only `resolve` / `materialize` / `status` / `refresh` — **no read, no search, no extract**. `source-local`'s only real engine call is `git status --porcelain`. `vault:v1` is that missing block.

## Why it "arrives strong" (not an echo)

Three pieces already exist in-repo, so the plugin has real lineage:

1. **Front-half** — the `dgk-vault-search` CI smoke runs the whole `skill-contract-v1` plan→decision→receipt pipeline over an external vault `SKILL.md`, stopping exactly at `requiresRuntimeDispatch:true` / `executed:false`. Only the runtime `instance.call` is missing.
2. **Output** — `extract` emits `records-contract-v1` `KnowledgeRecord`s, which `node-contract-v1`'s `graphNodeToNormalised(node, {sourcePlugin})` projects into the `@context/@type/@id/refarm:sourcePlugin` node the silo already stores end to end. rcdc5's engine even declares a `RefarmSink(futuro)` + `createJsonLdFileSink` emitting exactly that node shape.
3. **Template** — `quality-checker-ref` is the **proven deny-all** WASM component (world imports nothing = sandbox by absence). `vault:v1` mirrors `quality:v1`'s two-faces-one-contract shape.

## The contract (`@refarm.dev/vault-contract-v1`)

Two faces, kept in step:

- **Native (in-process)** — `src/types.ts`: `VaultSurface.run(verb, note, profile) → VaultResult`. `VaultNote = {path, text}` (the **host** reads the file). `VaultProfile` is **matcher-is-data** — each rule's `match` is opaque JSON the surface interprets, scoped by `verb`. `VaultResult` populates exactly one output list per verb (records / hits / plans / findings).
- **Sovereign WASM** — `wit/vault.wit` (package `refarm:vault@0.1.0`, world `vault-surface`): the same `run`, exported by a component that **imports NOTHING**. Registered in the `check:wit` guard's independent-WIT allowlist. (`result` is a WIT keyword → the record is `run-result`.)

The reference surface (`src/reference.ts`) ships one honest matcher per verb (`contains` / `frontmatter` / `prefix-route` / `requires`); the conformance harness (`src/conformance.ts`) pins the boundary — determinism, one-output-shape-per-verb, forward-safety (an unknown `match.type` fires nothing, never errors).

## Decisions (Arthur, 2026-07-04)

- **All four verbs**, not just `extract`.
- 1st dispatch proof **reuses the deny-all path** (host instantiates the jco-transpiled component with a deny-all WASI table, as `quality-checker-ref` does today) — NOT touching the tractor `instance.call` yet.
- Component language: **TS via `componentize-js`** (`@bytecodealliance/componentize-js@0.20.0` is already installed) — the first non-agent plugin in TS.
- **TS-only foundation first**, `§8` window kept short and well-rehearsed.

## Foundation (TS-only) — DONE

- **Contract** (`3cc68301`) — `src/types.ts` (`VaultNote`, `VaultProfile` matcher-is-data, 4 verbs, `VaultResult`), `src/reference.ts` (one honest matcher per verb), `src/conformance.ts` (boundary pinned), `wit/vault.wit` (`refarm:vault@0.1.0`, world imports nothing), `src/in-memory.ts`.
- **Emit** (`949d5ed8`) — `vaultRecordToNode`: `KnowledgeRecord → GraphNode → NormalisedNode`, lands on the canonical `@context/@type/@id/refarm:sourcePlugin/refarm:capability` node. Host stamps `createdAtNs` (the surface has no clock — a test pins this). `KnowledgeRecord → graphNodeToNormalised` asserted against refarm's OWN node-contract-v1, since rcdc5's `createJsonLdFileSink` turned out to be documented intent, not present source.
- **Dispatch** (`48662456`) — `vaultDispatchTask`: a vault verb → an `effort-contract-v1` `Task`, wire-parity-proven against the Rust sidecar `EffortTask` (`id`, `pluginId`, `fn`, `args`), with a drift-guard. `fn` = the verb (a non-lifecycle name the sidecar doesn't route yet — the `§8` gap).
- **Manifest** (`ae2a4276`) — `buildVaultPluginManifest`: verbs as `provides` + `.wasm` entry. DELIBERATELY invalid until `integrity` is stamped (a real build requirement, proven by running `validatePluginManifest`); the `§8` install is just that one swap.

## `§8` — DONE (`91e66fc8`): the first non-agent WASM plugin

`@refarm.dev/vault-surface-ref` — a NEW package (sibling of `quality-checker-ref`, but TS not Rust), created with Arthur's explicit `§8` confirmation. It does NOT edit `packages/tractor/**` or `packages/plugin-manifest/**` (consumed read-only) and adds no verb to `instance.call`.

- **The first TS→WASM component in the repo.** `src/surface.js` (pure compute, dependency-free — runs in StarlingMonkey) → `jco componentize --disable all` → `dist/vault_surface.wasm` (~12MB) → `jco transpile` → `pkg/`. `componentize-js` was installed but never exercised until now; it worked first try, no `§7` OOM (it's StarlingMonkey, not cargo/LLVM).
- **The sandbox is the ABSENCE of imports.** `--disable all` makes the transpiled `ImportObject` `{}` — the component imports nothing. The loader (`src/index.ts`) instantiates with an EMPTY capability table and `run()` still returns — stronger than the deny-all stubs `quality-checker-ref` needed, because there is no import through which to reach fs/network.
- **Dispatch proven for real** (`src/surface.test.ts`, 7 tests, `skipIf !pkg`): all four verbs dispatch through the real component; the empty-import sandbox is asserted; and the `§8` install swap is proven end-to-end — `computeSha256Digest` of the built `.wasm` → `sha256-<hex>` → `buildVaultPluginManifest` validates.

### The loop — vault runs on the real runtime as an integration plugin (`5234ea82`)

The first design instinct — teach the tractor host the standalone `vault-surface` world — was **wrong**, and a recon (`wf_06d238ea`) corrected it: the extension architecture is already universal. **Every** refarm plugin exports the SAME canonical `integration` interface (`refarm:plugin@0.1.0`: `setup`/`ingest`/`push`/`teardown`/`get-help-nodes`/`metadata`/`on-event`/`respond`); the agent is only special because it implements `respond` for real. The host loads and calls ANY `integration` plugin the same way. So vault should SPEAK `integration`, not a world the host has no bindings for.

- **`src/plugin.js`** (in `vault-surface-ref`) exports `integration` (world `refarm-plugin`, importing `tractor-bridge`) — the first refarm integration plugin built from TS. The runtime only calls `setup`/`ingest`/`teardown`/`metadata`/`on-event` (respond/push/get-help-nodes are dead channels), so vault dispatch rides the one live entrypoint: `on-event('vault:dispatch', {verb,note,profile,replyRef?})` runs the vault core and, since `on-event` returns nothing, emits results OUT through the imported `tractor-bridge store-node` — the exact side channel the agent uses.
- **Build chain** (the TS→WASM-with-shared-core pattern): `run-core.js` holds the dispatch logic, shared by BOTH entries (`surface.js` = sandbox-by-absence world; `plugin.js` = integration world). Each entry is `esbuild --bundle --external:refarm:*` (inlines the core, keeps `refarm:*` imports external — componentize does NOT resolve relative imports) then `jco componentize`.
- **Proven** (`plugin.test.ts`): `on-event('vault:dispatch', extract)` runs through the REAL component and stores a KnowledgeRecord via a functional test `tractor-bridge`. `loadVaultPluginComponent` ships the reusable loader. ZERO tractor edits.

### Follow-on (optional, not done)

- Load the plugin through the REAL `load_plugin` with the real host bridge (not a test double); extend to all four verbs.
- Decide the dispatch model: keep the async on-event → store-node side channel (matching the agent) as permanent, OR invest `§8` to make `respond` a live host-called request→response channel (a `call_respond` binding) so search/profile can return synchronously.
- A real `plugin-manifest` install via barn, swapping the inert `entry` for the hashed `.wasm`; eventually route non-`respond` verbs through the sidecar `EffortTask` so vault dispatch becomes a first-class Effort.
- (Done: `validate-packages` learned the `wasm-jco-component-ts` kind, `5a82ef5e`.)

## Open questions

- The `extract` output is `records`, not `quality` findings → its own `refarm:vault` world (done), not overloading `refarm:quality`.
- The extraction **profile** (a domain's split/parse rules, PARA maps) stays **last-mile** — the POC ships it as profile JSON; `SISTEMA_RULES` / PARA maps never enter refarm.
- First proof via the jco deny-all path (tiny `§8`) vs. through `instance.call` (bigger `§8` — adds a non-lifecycle verb to the tractor host).
