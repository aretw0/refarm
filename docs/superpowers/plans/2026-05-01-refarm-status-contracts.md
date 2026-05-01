# Refarm Status Package Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/trust`, `packages/runtime`, and the `buildRefarmStatusJson` builder in `packages/cli`, producing the `refarm status --json` shape without any DOM, Astro, or TUI dependency.

**Architecture:** Top-down from the canonical JSON shape in `docs/REFARM_STATUS_OUTPUT.md`. `packages/trust` and `packages/runtime` are new leaf packages (no intra-repo deps). The status builder lives in the existing `packages/cli` as a new `./status` export, composing homestead renderer descriptors with the new domain contracts.

**Tech Stack:** TypeScript (ESM), Vitest 4, `@refarm.dev/homestead/sdk/host-renderer`, `@refarm.dev/vtconfig` for test aliases, `@refarm.dev/tsconfig/node.json` base.

---

## File Map

**New files:**
- `packages/trust/package.json`
- `packages/trust/tsconfig.json`
- `packages/trust/tsconfig.build.json`
- `packages/trust/vitest.config.ts`
- `packages/trust/src/index.ts`
- `packages/trust/test/trust.test.ts`
- `packages/runtime/package.json`
- `packages/runtime/tsconfig.json`
- `packages/runtime/tsconfig.build.json`
- `packages/runtime/vitest.config.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/test/runtime.test.ts`
- `packages/cli/src/status.ts`
- `packages/cli/src/status.test.ts`

**Modified files:**
- `tsconfig.json` (root) — add path aliases for `@refarm.dev/trust`, `@refarm.dev/runtime`, `@refarm.dev/homestead/sdk/host-renderer`
- `packages/cli/package.json` — add deps + `./status` export path
- `packages/cli/tsconfig.json` — add path aliases for homestead, trust, runtime

---

## Task 1: Scaffold `packages/trust`

**Files:**
- Create: `packages/trust/package.json`
- Create: `packages/trust/tsconfig.json`
- Create: `packages/trust/tsconfig.build.json`
- Create: `packages/trust/vitest.config.ts`

- [ ] **Step 1: Create package.json**

`packages/trust/package.json`:
```json
{
  "name": "@refarm.dev/trust",
  "version": "0.1.0",
  "description": "Refarm Trust — domain contract for trust profile and policy summaries",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@refarm.dev/vtconfig": "*"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

`packages/trust/tsconfig.json`:
```json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

`packages/trust/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

`packages/trust/vitest.config.ts`:
```typescript
import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../")),
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  })
);
```

- [ ] **Step 5: Install deps**

```bash
npm install --prefix packages/trust
```

Expected: lockfile updated, `node_modules` created in `packages/trust`.

---

## Task 2: Implement `packages/trust` with TDD

**Files:**
- Create: `packages/trust/test/trust.test.ts`
- Create: `packages/trust/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/trust/test/trust.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { createNullTrustSummary } from "../src/index.js";

describe("trust summary contracts", () => {
  it("creates a null summary with dev profile and zero counts", () => {
    expect(createNullTrustSummary()).toEqual({
      profile: "dev",
      warnings: 0,
      critical: 0,
    });
  });

  it("accepts a custom profile string", () => {
    expect(createNullTrustSummary("prod")).toEqual({
      profile: "prod",
      warnings: 0,
      critical: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix packages/trust run test
```

Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Write the implementation**

`packages/trust/src/index.ts`:
```typescript
export interface TrustSummary {
  profile: string;
  warnings: number;
  critical: number;
}

export function createNullTrustSummary(profile = "dev"): TrustSummary {
  return { profile, warnings: 0, critical: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix packages/trust run test
```

Expected:
```
Test Files  1 passed (1)
     Tests  2 passed (2)
```

- [ ] **Step 5: Build the package**

```bash
npm --prefix packages/trust run build
```

Expected: `packages/trust/dist/index.js` and `packages/trust/dist/index.d.ts` created.

- [ ] **Step 6: Commit**

```bash
git add packages/trust/
git commit -m "feat(trust): add TrustSummary contract and null stub"
```

---

## Task 3: Scaffold `packages/runtime`

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/tsconfig.build.json`
- Create: `packages/runtime/vitest.config.ts`

- [ ] **Step 1: Create package.json**

`packages/runtime/package.json`:
```json
{
  "name": "@refarm.dev/runtime",
  "version": "0.1.0",
  "description": "Refarm Runtime — domain contract for host runtime state summaries",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@refarm.dev/vtconfig": "*"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

`packages/runtime/tsconfig.json`:
```json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

`packages/runtime/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

`packages/runtime/vitest.config.ts`:
```typescript
import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../")),
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  })
);
```

- [ ] **Step 5: Install deps**

```bash
npm install --prefix packages/runtime
```

Expected: lockfile updated.

---

## Task 4: Implement `packages/runtime` with TDD

**Files:**
- Create: `packages/runtime/test/runtime.test.ts`
- Create: `packages/runtime/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/runtime/test/runtime.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { createNullRuntimeSummary } from "../src/index.js";

describe("runtime summary contracts", () => {
  it("creates a null summary with ready false and empty strings", () => {
    expect(createNullRuntimeSummary()).toEqual({
      ready: false,
      databaseName: "",
      namespace: "",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix packages/runtime run test
```

Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Write the implementation**

`packages/runtime/src/index.ts`:
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix packages/runtime run test
```

Expected:
```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

- [ ] **Step 5: Build the package**

```bash
npm --prefix packages/runtime run build
```

Expected: `packages/runtime/dist/index.js` and `packages/runtime/dist/index.d.ts` created.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/
git commit -m "feat(runtime): add RuntimeSummary contract and null stub"
```

---

## Task 5: Wire root tsconfig path aliases

**Files:**
- Modify: `tsconfig.json` (root)

The root `tsconfig.json` is used by editors and the global type-check pass. It needs aliases for the two new packages and for the homestead sub-path that `status.ts` will import.

- [ ] **Step 1: Add three path aliases to root tsconfig.json**

In `tsconfig.json`, inside `compilerOptions.paths`, add these three entries (order doesn't matter — insert near existing `@refarm.dev/*` entries):

```json
"@refarm.dev/trust": ["./packages/trust/src/index"],
"@refarm.dev/runtime": ["./packages/runtime/src/index"],
"@refarm.dev/homestead/sdk/host-renderer": ["./packages/homestead/src/sdk/host-renderer"]
```

The `paths` block in the root tsconfig currently has many `@refarm.dev/homestead/sdk/*` entries but is missing `host-renderer`. Add `trust` and `runtime` alongside the existing package entries, and add `homestead/sdk/host-renderer` alongside the other homestead sub-paths.

- [ ] **Step 2: Verify type-check still passes**

```bash
npm run type-check 2>&1 | grep -E "error|warning" | head -20
```

Expected: no new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore(tsconfig): add path aliases for trust, runtime, homestead/sdk/host-renderer"
```

---

## Task 6: Add status builder to `packages/cli`

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/status.ts`
- Create: `packages/cli/src/status.test.ts`

### Step 1: Update package.json

- [ ] **Add dependencies and export path**

In `packages/cli/package.json`:

Add to `"dependencies"`:
```json
"@refarm.dev/homestead": "*",
"@refarm.dev/trust": "*",
"@refarm.dev/runtime": "*"
```

Add to `"exports"` (alongside the existing `"bin"` / `"main"` — the package currently has no named exports object, so create one):
```json
"exports": {
  "./status": {
    "types": "./dist/status.d.ts",
    "import": "./dist/status.js"
  }
}
```

Note: the current `packages/cli/package.json` uses `"main"` and `"types"` top-level fields (not an `exports` map). Keep those fields; just add the new `exports` map alongside them for the named `./status` sub-path.

- [ ] **Install deps**

```bash
npm install --prefix packages/cli
```

Expected: `@refarm.dev/homestead`, `@refarm.dev/trust`, `@refarm.dev/runtime` added to lockfile.

### Step 2: Update tsconfig.json

- [ ] **Add path aliases for new deps**

In `packages/cli/tsconfig.json`, inside `compilerOptions.paths`, add:
```json
"@refarm.dev/homestead/sdk/host-renderer": ["../homestead/dist/sdk/host-renderer.d.ts"],
"@refarm.dev/trust": ["../trust/dist/index.d.ts"],
"@refarm.dev/runtime": ["../runtime/dist/index.d.ts"]
```

The existing paths in this file already use `dist/*.d.ts` for all deps (e.g. `"@refarm.dev/silo": ["../silo/dist/index.d.ts"]`). Follow the same convention.

### Step 3: Write the failing tests

- [ ] **Create `packages/cli/src/status.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  createHomesteadHostRendererDescriptor,
} from "@refarm.dev/homestead/sdk/host-renderer";
import { createNullTrustSummary } from "@refarm.dev/trust";
import { createNullRuntimeSummary } from "@refarm.dev/runtime";
import { buildRefarmStatusJson } from "./status.js";

const HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
  "refarm-headless",
  "headless",
);

const BASE_OPTIONS = {
  host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
  renderer: HEADLESS_RENDERER,
  runtime: createNullRuntimeSummary(),
  trust: createNullTrustSummary(),
};

describe("buildRefarmStatusJson", () => {
  it("emits schemaVersion 1 always", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).schemaVersion).toBe(1);
  });

  it("maps host fields directly", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).host).toEqual({
      app: "apps/refarm",
      command: "refarm",
      profile: "dev",
      mode: "headless",
    });
  });

  it("maps renderer id, kind, and capabilities from descriptor", () => {
    const result = buildRefarmStatusJson(BASE_OPTIONS);
    expect(result.renderer.id).toBe("refarm-headless");
    expect(result.renderer.kind).toBe("headless");
    expect(result.renderer.capabilities).toContain("telemetry");
    expect(result.renderer.capabilities).toContain("diagnostics");
  });

  it("defaults all plugin counts to zero when no snapshot is provided", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).plugins).toEqual({
      installed: 0,
      active: 0,
      rejectedSurfaces: 0,
      surfaceActions: 0,
    });
  });

  it("derives rejectedSurfaces and surfaceActions from snapshot surfaces", () => {
    const result = buildRefarmStatusJson({
      ...BASE_OPTIONS,
      plugins: {
        snapshot: {
          renderer: HEADLESS_RENDERER,
          surfaces: {
            rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
            actions: [
              { actionId: "open-node", status: "requested", pluginId: "plugin-b" },
              { actionId: "close-node", status: "failed", pluginId: "plugin-c" },
            ],
          },
        },
      },
    });
    expect(result.plugins.rejectedSurfaces).toBe(1);
    expect(result.plugins.surfaceActions).toBe(2);
  });

  it("defaults streams to zero when not provided", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).streams).toEqual({ active: 0, terminal: 0 });
  });

  it("maps streams active and terminal from stream state", () => {
    const result = buildRefarmStatusJson({
      ...BASE_OPTIONS,
      streams: { active: 3, terminal: 1 },
    });
    expect(result.streams).toEqual({ active: 3, terminal: 1 });
  });

  it("adds renderer:non-interactive and renderer:no-rich-html for headless renderer", () => {
    const diagnostics = buildRefarmStatusJson(BASE_OPTIONS).diagnostics;
    expect(diagnostics).toContain("renderer:non-interactive");
    expect(diagnostics).toContain("renderer:no-rich-html");
  });

  it("emits no renderer diagnostics for web renderer", () => {
    const webRenderer = createHomesteadHostRendererDescriptor("refarm-web", "web");
    const diagnostics = buildRefarmStatusJson({ ...BASE_OPTIONS, renderer: webRenderer }).diagnostics;
    expect(diagnostics).not.toContain("renderer:non-interactive");
    expect(diagnostics).not.toContain("renderer:no-rich-html");
  });

  it("passes through null trust and runtime stubs unchanged", () => {
    const result = buildRefarmStatusJson(BASE_OPTIONS);
    expect(result.trust).toEqual({ profile: "dev", warnings: 0, critical: 0 });
    expect(result.runtime).toEqual({ ready: false, databaseName: "", namespace: "" });
  });
});
```

- [ ] **Step 4: Run tests to verify the new test fails**

```bash
npm --prefix packages/cli run test
```

Expected: existing 21 tests pass; new `status.test.ts` fails with `Cannot find module './status.js'`.

### Step 5: Write the implementation

- [ ] **Create `packages/cli/src/status.ts`**

```typescript
import {
  homesteadHostRendererCan,
  type HomesteadHostRendererDescriptor,
  type HomesteadHostRendererSnapshot,
  type HomesteadHostStreamState,
} from "@refarm.dev/homestead/sdk/host-renderer";
import type { TrustSummary } from "@refarm.dev/trust";
import type { RuntimeSummary } from "@refarm.dev/runtime";

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
): RefarmStatusJson {
  const { host, renderer, runtime, trust, streams, plugins } = options;
  return {
    schemaVersion: 1,
    host,
    renderer: {
      id: renderer.id,
      kind: renderer.kind,
      capabilities: renderer.capabilities,
    },
    runtime,
    plugins: {
      installed: plugins?.installed ?? 0,
      active: plugins?.active ?? 0,
      rejectedSurfaces: plugins?.snapshot?.surfaces?.rejected?.length ?? 0,
      surfaceActions: plugins?.snapshot?.surfaces?.actions?.length ?? 0,
    },
    trust,
    streams: {
      active: streams?.active ?? 0,
      terminal: streams?.terminal ?? 0,
    },
    diagnostics: buildStatusDiagnostics(renderer),
  };
}

function buildStatusDiagnostics(
  renderer: HomesteadHostRendererDescriptor,
): string[] {
  const diagnostics: string[] = [];
  if (!homesteadHostRendererCan(renderer, "interactive")) {
    diagnostics.push("renderer:non-interactive");
  }
  if (!homesteadHostRendererCan(renderer, "rich-html")) {
    diagnostics.push("renderer:no-rich-html");
  }
  return diagnostics;
}
```

- [ ] **Step 6: Run all cli tests to verify everything passes**

```bash
npm --prefix packages/cli run test
```

Expected:
```
Test Files  4 passed (4)
     Tests  31 passed (31)
```

(21 existing + 10 new status tests)

- [ ] **Step 7: Confirm type-check passes**

```bash
npm --prefix packages/cli run type-check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add buildRefarmStatusJson status builder"
```

---

## Task 7: Smoke-test the full gate

- [ ] **Step 1: Run the foundation smoke gate**

```bash
npm run gate:smoke:foundation
```

Expected: passes (includes `packages/cli run type-check`).

- [ ] **Step 2: Run all three new package test suites**

```bash
npm --prefix packages/trust run test && npm --prefix packages/runtime run test && npm --prefix packages/cli run test
```

Expected: all pass.

- [ ] **Step 3: Final commit if any cleanup needed, otherwise done**

No code changes needed if all tests pass. The contracts are live.
