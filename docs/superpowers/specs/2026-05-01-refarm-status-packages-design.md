# Design: Refarm Status Package Contracts

**Date:** 2026-05-01
**Approach:** Top-down (status-driven) — work backwards from the canonical JSON shape in `REFARM_STATUS_OUTPUT.md` to define domain contracts.

## Context

The goal is to implement a small, tested helper that produces the `refarm status --json` shape without depending on DOM, Astro, or TUI. Before building the status builder itself, the underlying domain contracts must be established. `packages/homestead` already covers renderer and surface/plugin telemetry; the missing pieces are trust state, runtime state, and a CLI composer.

## Package Structure

Three new packages, one existing package left unchanged:

```
packages/
  trust/       ← NEW — TrustSummary interface + createNullTrustSummary() stub
  runtime/     ← NEW — RuntimeSummary interface + createNullRuntimeSummary() stub
  cli/         ← NEW — buildRefarmStatusJson() + RefarmStatusJson type
  homestead/   ← UNCHANGED — HomesteadHostStreamState already covers streams
```

Dependency graph (all leaves are DOM/Astro/TUI-free):

```
packages/trust    ──┐
packages/runtime  ──┤──→ packages/cli
packages/homestead──┘
```

`packages/trust` and `packages/runtime` are leaves — no intra-repo dependencies.

## Contracts

### `packages/trust`

```typescript
export interface TrustSummary {
  profile: string;   // e.g. "dev", "prod", "ci"
  warnings: number;
  critical: number;
}

export function createNullTrustSummary(profile = "dev"): TrustSummary {
  return { profile, warnings: 0, critical: 0 };
}
```

### `packages/runtime`

```typescript
export interface RuntimeSummary {
  ready: boolean;
  databaseName: string;
  namespace: string;
}

export function createNullRuntimeSummary(): RuntimeSummary {
  return { ready: false, databaseName: "", namespace: "" };
}
```

### `packages/cli` — output type

Derived directly from the canonical shape in `REFARM_STATUS_OUTPUT.md`:

```typescript
export interface RefarmStatusJson {
  schemaVersion: 1;
  host: { app: string; command: string; profile: string; mode: string };
  renderer: { id: string; kind: string; capabilities: readonly string[] };
  runtime: RuntimeSummary;
  plugins: {
    installed: number;
    active: number;
    rejectedSurfaces: number;
    surfaceActions: number;
  };
  trust: TrustSummary;
  streams: { active: number; terminal: number };
  diagnostics: string[];
}
```

## Builder

`buildRefarmStatusJson` lives in `packages/cli` and is a pure transformer — no I/O, no DOM, no side effects.

```typescript
export interface RefarmStatusOptions {
  host: { app: string; command: string; profile: string; mode: string };
  renderer: HomesteadHostRendererDescriptor;
  runtime: RuntimeSummary;
  trust: TrustSummary;
  streams?: HomesteadHostStreamState;
  plugins?: {
    installed?: number;
    active?: number;
    snapshot?: HomesteadHostRendererSnapshot;
  };
}

export function buildRefarmStatusJson(
  options: RefarmStatusOptions,
): RefarmStatusJson
```

**Field derivation rules:**

| Output field | Source |
|---|---|
| `schemaVersion` | Constant `1` — never derived from input |
| `renderer.{id,kind,capabilities}` | Mapped directly from `HomesteadHostRendererDescriptor` |
| `plugins.rejectedSurfaces` | `snapshot.surfaces?.rejected?.length ?? 0` |
| `plugins.surfaceActions` | `snapshot.surfaces?.actions?.length ?? 0` |
| `plugins.{installed,active}` | `options.plugins?.{installed,active} ?? 0` |
| `streams.{active,terminal}` | `streams?.{active,terminal} ?? 0` |
| `diagnostics` | Derived via capability checks (mirrors `createStudioHeadlessDiagnostics` from `apps/dev`) |

The diagnostics logic from `apps/dev/src/lib/studio-headless-runtime.ts` (`createStudioHeadlessDiagnostics`) is migrated into `packages/cli` as the canonical implementation.

## Testing

Each package has pure unit tests (no DOM, no I/O, no Astro):

- **`packages/trust`** — `createNullTrustSummary()` returns correct shape; accepts custom profile string
- **`packages/runtime`** — `createNullRuntimeSummary()` returns correct shape; `ready` is `false` by default
- **`packages/cli`** — `buildRefarmStatusJson()` tested with renderer/snapshot/trust/runtime fixtures:
  - headless renderer with default capabilities → full JSON matches schema
  - renderer with missing capabilities → diagnostics includes `renderer:missing:<capability>`
  - snapshot with rejected surfaces → `plugins.rejectedSurfaces` reflects count
  - null stubs for trust/runtime → zero counts, `ready: false`

## Build Order

1. `packages/trust` — interface + stub + tests
2. `packages/runtime` — interface + stub + tests
3. `packages/cli` — `RefarmStatusJson` type + `buildRefarmStatusJson` + tests (imports trust, runtime, homestead)

`apps/refarm` scaffolding comes after these contracts are stable.

## Non-goals

- No `apps/refarm` scaffolding in this slice — CLI wiring comes after the contracts land
- No real trust policy implementation — `createNullTrustSummary` is the full scope for now
- No real runtime state source — `createNullRuntimeSummary` is the full scope for now
- No TUI package — deferred until there is contract pressure
- No stream-observer DOM cleanup — `HomesteadHostStreamState` is sufficient; cleanup deferred
