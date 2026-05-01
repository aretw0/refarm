# apps/refarm Scaffold — CLI Distro Binary

Delivers the `apps/refarm` CLI application, moving the binary entrypoint out of
`packages/cli` and wiring the first executable `refarm status --json` command.
Works backwards from the contracts established in `refarm-status-package-contracts.md`.

## Decision

`packages/cli` is split into two distinct things:

```
packages/cli    ← library only — buildRefarmStatusJson, RefarmStatusJson, types
apps/refarm     ← binary — all commands, Commander program, bin entrypoint
```

All 7 existing commands migrate from `packages/cli` to `apps/refarm` using a
TDD gate: tests are written before each command is moved.

## `packages/trust` addition

```typescript
export function createTrustSummaryFromTractor(tractor: Tractor): TrustSummary
```

Reads `tractor.trustManager` to derive `profile`, `warnings`, and `critical` counts.

## `packages/runtime` addition

```typescript
export function createRuntimeSummaryFromTractor(tractor: Tractor): RuntimeSummary
```

Returns `ready: true` once Tractor has booted, with `namespace` and `databaseName`
from the Tractor config.

## `apps/refarm` — status command

```typescript
// Boots an ephemeral, in-memory Tractor (no sync, logLevel: "silent")
// Extracts RuntimeSummary + TrustSummary via adapters
// Calls buildRefarmStatusJson from @refarm.dev/cli
// --json → stdout JSON; default → human-readable summary
```

The headless renderer descriptor is defined in `apps/refarm` and passed directly
to `buildRefarmStatusJson`.

## Migration gate

For each command: write test → copy to `apps/refarm` → delete from `packages/cli` → green.

Commands: `init`, `sow`, `guide`, `health`, `migrate`, `deploy`, `plugin`, `status`.

## `packages/cli` after migration

Retains only `src/status.ts` and `src/index.ts` with type re-exports.
Loses: `bin`, `commander`, `inquirer`, all command files.

## Smoke gate

```bash
npm test --workspace=apps/refarm
npm test --workspace=packages/cli
npm test --workspace=packages/trust
npm test --workspace=packages/runtime
```

## Non-goals

- No TUI package
- No Farmhand daemon integration — headless probe only
- No production release pipeline for `apps/refarm`
- No changes to `apps/dev`, `apps/me`, `apps/farmhand`
