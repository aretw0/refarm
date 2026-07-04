# `vault:v1` — the first real (non-agent) WASM plugin candidate

**Status:** TS-only foundation landed (contract + reference surface + conformance + WIT). Grounded by recon workflow `wf_510a0ee6` (4 agents, source-verified). The WASM component + host dispatch are a downstream `§8` slice.

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

## Remaining foundation (TS-only, before `§8`)

- **Emit** — assert `KnowledgeRecord → graphNodeToNormalised` equals the rcdc5 `createJsonLdFileSink` node shape.
- **Effort task** — assert `{pluginId, fn, args}` (`effort-contract-v1` `Task`) round-trips to the Rust sidecar `EffortTask {plugin_id, fn_name, args}`; extend the DGK smoke front-half to carry the `fn`.
- **Manifest** — a validated `plugin-manifest` object (`provides: ['vault:extract', …]`, `entry` → the future `.wasm`).

## `§8` (serialized handoff, later)

- Build `vault-*-ref` via `componentize-js` → a hashed `.wasm` (mind the `§7` RAM budget — serialized builds).
- Prove dispatch the same deny-all way `quality-checker-ref` is proven (host instantiates + asserts `run()` returns records while touching no fs).
- Real `plugin-manifest` install with SHA-256 integrity (barn), swapping the inert `entry` for the hashed `.wasm`. Follow-on: extend tractor `instance.call` beyond the four lifecycle verbs, OR add a component-dispatch path so the sidecar `EffortTask` routes to the component.

## Open questions

- The `extract` output is `records`, not `quality` findings → its own `refarm:vault` world (done), not overloading `refarm:quality`.
- The extraction **profile** (a domain's split/parse rules, PARA maps) stays **last-mile** — the POC ships it as profile JSON; `SISTEMA_RULES` / PARA maps never enter refarm.
- First proof via the jco deny-all path (tiny `§8`) vs. through `instance.call` (bigger `§8` — adds a non-lifecycle verb to the tractor host).
