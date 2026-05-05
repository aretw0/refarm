# Design: apps/refarm Scaffold — CLI Distro Binary

**Date:** 2026-05-01
**Approach:** Lift-and-shift with TDD gate — write tests before moving each command, then migrate all commands from `packages/cli` to `apps/refarm`.

## Context

The previous slice established domain contracts (`packages/trust`, `packages/runtime`) and the `buildRefarmStatusJson` pure transformer in `packages/cli`. The next step delivers the actual `apps/refarm` CLI binary: the canonical distro entrypoint that makes `refarm status --json` executable.

`packages/cli` currently violates the `apps/` vs `packages/` boundary — it is simultaneously a library and a binary. This slice corrects that by making `packages/cli` a library-only package and moving the binary and all commands to `apps/refarm`.

## Package Structure

```
apps/refarm/
  src/
    commands/
      init.ts
      sow.ts
      guide.ts
      health.ts
      migrate.ts
      deploy.ts
      plugin.ts
      status.ts        ← new: headless Tractor probe + buildRefarmStatusJson
    program.ts         ← Commander root
    index.ts           ← #!/usr/bin/env node, program.parse()
  test/
    commands/          ← one test file per command
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts

packages/cli/          ← library only after migration
  src/
    status.ts          ← buildRefarmStatusJson (unchanged)
    index.ts           ← type re-exports only
  (no bin, no commander, no inquirer)
```

## Dependency Graph

```
packages/trust    ──┐
packages/runtime  ──┤──→ packages/cli (library)
packages/homestead──┘         │
                              ↓
                        apps/refarm (binary)
                        + packages/tractor
                        + chalk, commander, inquirer
```

## The `status` Command — Headless Tractor Probe

`apps/refarm/src/commands/status.ts` boots an ephemeral Tractor (in-memory, no sync, `logLevel: "silent"`) to extract real runtime and trust state:

```typescript
export const statusCommand = new Command("status")
  .description("Report host status")
  .option("--json", "Output machine-readable JSON")
  .action(async (options) => {
    const tractor = await Tractor.boot({
      namespace: readNamespaceFromConfig() ?? "refarm-main",
      storage: createMemoryStorage(),
      identity: createEphemeralIdentity(),
      logLevel: "silent",
    });

    const runtime = createRuntimeSummaryFromTractor(tractor);
    const trust   = createTrustSummaryFromTractor(tractor);

    const json = buildRefarmStatusJson({
      host:     { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
      renderer: REFARM_HEADLESS_RENDERER,
      runtime,
      trust,
    });

    if (options.json) {
      console.log(JSON.stringify(json, null, 2));
    } else {
      printStatusSummary(json);
    }

    await tractor.shutdown?.();
  });
```

Two new adapter functions in domain packages (not in `apps/`):

- `packages/runtime`: `createRuntimeSummaryFromTractor(tractor): RuntimeSummary` — `ready: true`, namespace from config, databaseName from storage
- `packages/trust`: `createTrustSummaryFromTractor(tractor): TrustSummary` — reads `tractor.trustManager` for profile and warning/critical counts

## Migration Strategy — Gate Per Command

For each of the 7 existing commands in `packages/cli/src/commands/`:

1. Write test in `apps/refarm/test/commands/<cmd>.test.ts` — mock external deps
2. Copy implementation to `apps/refarm/src/commands/<cmd>.ts`
3. Delete from `packages/cli/src/commands/`
4. All tests green → next command

### Test coverage targets

| Command | Test focus |
|---|---|
| `init` | Creates `refarm.config.json` with correct shape |
| `sow` | Stores secrets in Silo; no secrets leak to stdout |
| `guide` | Generates `SETUP_GUIDE.md` with expected sections |
| `health` | Returns healthy/unhealthy based on mock checks |
| `migrate` | Runs migration without error; dry-run writes nothing |
| `deploy` | Dry-run produces expected log without calling Windmill |
| `plugin` | list/install/remove sub-commands trigger correct registry calls |
| `status` | `--json` produces valid `RefarmStatusJson`; `schemaVersion: 1` |

## `packages/cli` After Migration

Retains only:

- `src/status.ts` — `buildRefarmStatusJson`, `RefarmStatusJson`, `RefarmStatusOptions`
- `src/index.ts` — re-exports of public types

Removes from `package.json`: `bin`, `commander`, `inquirer`, `chalk`, and all command-specific dependencies that belong to `apps/refarm`.

## Smoke Gate

All of the following must be green before the slice is done:

```bash
npm test --workspace=apps/refarm
npm test --workspace=packages/cli
npm test --workspace=packages/trust
npm test --workspace=packages/runtime
```

## Build Order

1. `packages/trust` — add `createTrustSummaryFromTractor` adapter + tests
2. `packages/runtime` — add `createRuntimeSummaryFromTractor` adapter + tests
3. `apps/refarm` — scaffold package, vitest config, tsconfigs
4. `apps/refarm` — migrate `init` (test → move → gate)
5. `apps/refarm` — migrate `sow` (test → move → gate)
6. `apps/refarm` — migrate `guide` (test → move → gate)
7. `apps/refarm` — migrate `health` (test → move → gate)
8. `apps/refarm` — migrate `migrate` (test → move → gate)
9. `apps/refarm` — migrate `deploy` (test → move → gate)
10. `apps/refarm` — migrate `plugin` (test → move → gate)
11. `apps/refarm` — add `status` command (test → implement → gate)
12. `packages/cli` — strip to library-only, remove bin/commander/inquirer
13. Smoke gate: all workspaces green

## Non-goals

- No TUI package in this slice
- No real Farmhand daemon integration — headless probe only
- No `apps/refarm` production release pipeline — distro publishing deferred
- No changes to `apps/dev`, `apps/me`, `apps/farmhand`
