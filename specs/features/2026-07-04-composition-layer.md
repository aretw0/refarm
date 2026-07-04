# Composition layer — `config.json plugins[]` (slice #2)

**Status:** Planned (workflow `wf_22976822-658`, 9 agents, source-verified). Verdict: **config.json**, not the ledger.

## The three axes, three homes

Slice #1 established the BYTES axis (asset-resolver content-store) and the imported-skill
node-ledger (the LIST of what's imported, as content-addressed pointers). This slice adds the
**COMPOSITION** axis — which packages a scope *activates*, with pi-style `!`-surface suppression.

| Axis | Concern | Home |
| --- | --- | --- |
| DECLARATION | what a package OFFERS | the item's own manifest / `SKILL.md` / `package.json pi:{...}` |
| COMPOSITION | which packages a scope turns ON + surface suppression | **`config.json plugins[]`** (this slice) |
| BYTES | the content itself | asset-resolver content-store (`<scope>/.refarm/assets/<hash>`) |

## Why config.json, not the ledger

The ledger design was **refuted at source**:
- Its justification ("reuse `openScopedLedgerLayers`/`readLayeredNode`") is false — those have **zero
  production consumers**, and slice #1's `loadPersistedImportedSkills` hand-rolls its own scope loop.
- `readLayeredNode` resolves exactly ONE id; it structurally cannot enumerate a composition LIST.
- pi keeps composition in the **human-editable** `.pi/settings.json` → config.json is the faithful mirror
  ("refarm IS the user's package.json"); a workspace `config.json` is git-diffable, a gitignored
  `.refarm/…/ledger.json` is not.

`plugins` is an **additive top-level field**, NOT a `ConfigKey`: it stays out of the closed
`CONFIG_KEYS` union and the scalar get/set/unset/parse chain. Safe because:
- `runtime-config.ts readConfig` JSON.parses and reads only `autostart/runtime.sidecarUrl/tractor.engine`
  → an unknown top-level `plugins[]` is invisible to the runtime resolver (no scalar regression).
- `config.ts persistConfigValue` does full-object read → mutate one field → full-object write, so a
  `config set` preserves a sibling `plugins[]` and vice-versa.

## The CRITICAL correction (co-habitation guarantee)

`config.ts configPath({local:false})` uses `os.homedir()` (REFARM_HOME-**blind**), while the skill-ledger's
`userHome = dirname(resolveRefarmHome(env))` **honors** `REFARM_HOME`. The composition resolver MUST pin its
user root to config.ts's convention (`os.homedir()`), NOT borrow the skill-ledger roots — otherwise scalars
and `plugins[]` land in different files under a custom `REFARM_HOME`. Workspace tier already agrees
(both `cwd/.refarm/config.json`).

## Shape (mirrors pi exactly; surface vocabulary is refarm's)

```ts
type SurfacePattern = string;                 // "skills/foo" (allow) | "!skills/foo" (deny)
interface PackageSourceObject {
  source: string;                             // "npm:@scope/pkg" | "../rel" | "@refarm/agent"
  skills?: SurfacePattern[];
  tools?: SurfacePattern[];
  themes?: SurfacePattern[];
  commands?: SurfacePattern[];
}
type PackageSource = string | PackageSourceObject;
interface RefarmCliConfig { /* existing */ plugins?: PackageSource[]; }
```

`surfaceActive(entry, surface, id)` ported 1:1 from pi `configuredExtensionActive`
(pi-parity.mjs:143-156): bare-string/absent-key → all active; present-`[]` → suppress-all; else
`(includes.size===0 || includes.has(id)) && !excludes.has(id)`. **PRESENT-EMPTY vs ABSENT is
load-bearing.** Cross-scope fold = last-wins REPLACE by `source` (matches skill-ledger's
`effectivePointers.set` overwrite doctrine). pi's per-key cross-scope union is a deferred divergence.

## Org tier

Reuse `resolveOrgRoot` (opt-in, `REFARM_ORG_HOME`, no default) exactly as the skill ledger. A SEPARATE
3-tier resolver folds `config.json plugins[]` via `orderedScopeStorePaths('config.json', roots)`,
apply-order `[org, workspace, user]`, folded left-to-right (user wins). Does NOT touch runtime-config.ts's
private 2-tier `configPaths` (the 5 scalars stay 2-tier — additive constraint).

## Command surface (collision-free — `config plugins`, NOT `plugin`)

`refarm plugin` already owns physical runtime lifecycle (barn/npm/WASM install/update/list/status/reload/bundle).
Composition is a different concern → a `plugins` subgroup under `config` (beside the existing `profile`):
- `config plugins list [--scope] [--effective] [--json]` — fold active tiers, tag origin scope
- `config plugins add <source> [--scope] [--json]` — RMW append bare-string, idempotent by source
- `config plugins remove <source> [--scope] [--json]` — DE-DECLARE (NOT physical uninstall — help says so)
- `config plugins suppress <source> <surface> <pattern> [--scope]` — promote to object, add `!pattern`
- `config plugins unsuppress <source> <surface> <pattern> [--scope]` — remove pattern, drop key when empty

## Slices (each provable end-to-end on the built binary)

- **2.1** SCHEMA + PREDICATE — `plugins?` field + new `utils/composition.ts` (types + `getSource` +
  `normalizeSurfacePath` + `surfaceActive`) + vitest. Prove: type-check + suite green; `config --json`
  byte-unchanged.
- **2.2** 3-TIER RESOLVER (read) — `resolveComposition(deps,env)` folding `config.json` across
  `[org,workspace,user]` last-wins by source, user root pinned to `os.homedir()`. Prove: seeded configs
  fold; org opt-in drops without `REFARM_ORG_HOME`; user path == config.ts `configPath({local:false})`
  under custom `REFARM_HOME`.
- **2.3** CLI `config plugins list` (read-only first). Prove: prints effective set + scopes; `refarm plugin
  list` still prints physical state (no collision).
- **2.4** CLI `add` + `remove` (bare-string RMW). Prove: add→list shows; re-add no-op; remove drops;
  scalar+list co-habit one file.
- **2.5** CLI `suppress` + `unsuppress` (the `!`-grammar). Prove: promote to object, `!pattern` written;
  `list --effective` reflects; unsuppress restores + drops emptied key.
