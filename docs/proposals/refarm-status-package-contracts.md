# Refarm Status Package Contracts

Establishes the domain package contracts that feed `refarm status --json`, working
backwards from the canonical shape defined in [Refarm Status Output](../REFARM_STATUS_OUTPUT.md).

## Decision

Three new packages cover the missing domains. `packages/homestead` is unchanged —
`HomesteadHostStreamState` already models streams.

```
packages/trust    ← TrustSummary interface + null stub
packages/runtime  ← RuntimeSummary interface + null stub
packages/cli      ← buildRefarmStatusJson() + RefarmStatusJson type
```

Dependency graph:

```
packages/trust    ──┐
packages/runtime  ──┤──→ packages/cli
packages/homestead──┘
```

All three are DOM/Astro/TUI-free. `packages/trust` and `packages/runtime` are leaves
with no intra-repo dependencies.

## `packages/trust`

```typescript
export interface TrustSummary {
  profile: string;  // "dev" | "prod" | "ci" | ...
  warnings: number;
  critical: number;
}

export function createNullTrustSummary(profile = "dev"): TrustSummary {
  return { profile, warnings: 0, critical: 0 };
}
```

No real trust policy implementation in this slice. `createNullTrustSummary` is a valid
implementation for contexts without a live trust source (CI headless, `--offline`).

## `packages/runtime`

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

## `packages/cli`

### Output type

Mirrors the canonical shape from `REFARM_STATUS_OUTPUT.md`:

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

### Builder

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

export function buildRefarmStatusJson(options: RefarmStatusOptions): RefarmStatusJson
```

`buildRefarmStatusJson` is a pure transformer — no I/O, no DOM, no side effects.

Field derivation:

| Output field | Source |
|---|---|
| `schemaVersion` | Constant `1` |
| `renderer.{id,kind,capabilities}` | Mapped from `HomesteadHostRendererDescriptor` |
| `plugins.rejectedSurfaces` | `snapshot.surfaces?.rejected?.length ?? 0` |
| `plugins.surfaceActions` | `snapshot.surfaces?.actions?.length ?? 0` |
| `plugins.{installed,active}` | `options.plugins?.{installed,active} ?? 0` |
| `streams.{active,terminal}` | `streams?.{active,terminal} ?? 0` |
| `diagnostics` | Capability checks — canonical migration of `createStudioHeadlessDiagnostics` from `apps/dev` |

## Testing

Pure unit tests in each package — no DOM, no I/O, no Astro:

- `packages/trust` — null stub shape; custom profile string
- `packages/runtime` — null stub shape; `ready` defaults to `false`
- `packages/cli` — `buildRefarmStatusJson` with fixtures covering: headless renderer
  with default capabilities, missing capabilities → diagnostic codes, rejected surfaces
  → plugin counts, null stubs → zero counts

## Build order

1. `packages/trust`
2. `packages/runtime`
3. `packages/cli`

`apps/refarm` scaffolding follows once these contracts are stable.

## Non-goals

- No `apps/refarm` scaffolding in this slice
- No real trust or runtime implementation — null stubs are the full scope
- No TUI package
- No stream-observer DOM cleanup — deferred
