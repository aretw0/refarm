# Source Contract v1 (the Librarian) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `source:v1` capability contract and a git implementation so Refarm can materialize a stable local copy of any remote repo for read-only inspection (the "librarian").

**Architecture:** Ports-and-adapters. `source-contract-v1` is the port (types + conformance + in-memory reference, zero runtime deps). `source-git` is the git adapter (real provider, depends only on `git`). Both are pure SDK — neither depends on `dispatch-surface` or the kernel. A dogfood smoke proves Refarm consuming the provider directly. The `source-dispatch` adapter is explicitly out of scope (deferred).

**Tech Stack:** TypeScript (ESM-only), Node ≥22, pnpm@11.7.0, turbo, vitest. Workspace configs `@refarm.dev/{tsconfig,vtconfig,eslint-config}`.

**Spec:** `specs/features/2026-06-24-source-contract-v1.md`

## Global Constraints

- **Run environment:** all commands run inside the `cranky_bassi` devcontainer, NOT the Windows host. Editing files happens on the host; running `git`/`pnpm`/`vitest` happens in the container.
- **Package manager:** `pnpm@11.7.0`. Per-package script: `pnpm -C packages/<name> run <script>`.
- **Node:** `>=22`. **Module:** ESM-only (`"type": "module"`, `.js` import specifiers in TS).
- **Scope:** package names use `@refarm.dev/*` (matches existing contracts; the `@aretw0` vs `@refarm.dev` publish-scope split is out of scope here).
- **Contract package is zero-runtime-dependency** (pure types + validation), like `storage-contract-v1`.
- **Capability string:** exactly `"source:v1"`.
- **Conformance total:** `7` validations.
- **Cache default (git):** `~/.cache/checkouts/<host>/<org>/<repo>`. **Partial clone filter default:** `blob:none`. **Stale default:** `300` seconds.
- **Pattern source of truth:** mirror `packages/storage-contract-v1` for file layout, tsconfig/vitest/eslint configs, and conformance shape.
- **Deferred (do NOT build here):** `source-dispatch` adapter, `source-local` real-FS package, `tarball` kind, `dgk` consumption.

---

### Task 1: Scaffold `source-contract-v1` package + types

**Files:**
- Create: `packages/source-contract-v1/package.json`
- Create: `packages/source-contract-v1/tsconfig.json`
- Create: `packages/source-contract-v1/tsconfig.build.json`
- Create: `packages/source-contract-v1/vitest.config.ts`
- Create: `packages/source-contract-v1/eslint.config.mjs`
- Create: `packages/source-contract-v1/src/types.ts`
- Create: `packages/source-contract-v1/src/schema.ts`
- Create: `packages/source-contract-v1/src/index.ts`
- Create: `packages/source-contract-v1/README.md`

**Interfaces:**
- Produces: `SOURCE_CAPABILITY`, `SourceKind`, `SourceErrorCode`, `SourceLocation`, `MaterializeOptions`, `MaterializeAction`, `MaterializeResult`, `SourceStatus`, `SourceTelemetryEvent`, `SourceProvider`, `SourceConformanceResult` (from `types.ts`); `isSourceLocation`, `isMaterializeResult` (from `schema.ts`).

- [ ] **Step 1: Create `package.json`** (mirror of `storage-contract-v1`)

```json
{
	"name": "@refarm.dev/source-contract-v1",
	"version": "0.1.0",
	"description": "Versioned source capability contract (source:v1) and conformance suite",
	"type": "module",
	"main": "./dist/index.js",
	"types": "./dist/index.d.ts",
	"exports": {
		".": {
			"import": "./dist/index.js",
			"types": "./dist/index.d.ts"
		}
	},
	"scripts": {
		"build": "tsc --project tsconfig.build.json",
		"dev": "tsc --project tsconfig.build.json --watch",
		"lint": "eslint src",
		"type-check": "tsc --noEmit",
		"type-check:dist": "tsc --project tsconfig.build.json --noEmit",
		"test": "vitest run",
		"test:unit": "vitest run",
		"clean": "rm -rf dist",
		"test:conformance": "vitest run src/conformance.test.ts"
	},
	"keywords": ["plugin", "capability", "source", "checkout", "contract", "conformance"],
	"author": "Refarm Contributors",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "https://github.com/aretw0/refarm.git",
		"directory": "packages/source-contract-v1"
	},
	"bugs": { "url": "https://github.com/aretw0/refarm/issues" },
	"homepage": "https://refarm.dev.br",
	"files": ["dist", "README.md"],
	"publishConfig": { "access": "public" },
	"devDependencies": {
		"@refarm.dev/eslint-config": "workspace:*",
		"@refarm.dev/tsconfig": "workspace:*",
		"@refarm.dev/vtconfig": "workspace:*"
	}
}
```

- [ ] **Step 2: Create the three config files** (verbatim copies of `storage-contract-v1`)

`tsconfig.json`:
```json
{
	"extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
	"compilerOptions": { "outDir": "dist", "rootDir": "src", "baseUrl": "../.." },
	"include": ["src/**/*"]
}
```

`tsconfig.build.json`:
```json
{
	"extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
	"compilerOptions": { "rootDir": "src" }
}
```

`vitest.config.ts`:
```ts
import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: { alias: getAliases(path.resolve(__dirname, "../../")) },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  })
);
```

`eslint.config.mjs`:
```js
// @ts-check
import { withNode } from '@refarm.dev/eslint-config/node';

export default withNode(
  { ignores: ['dist/**', '**/*.d.ts'] },
  { files: ['src/**/*.ts', 'src/**/*.tsx'] },
);
```

- [ ] **Step 3: Create `src/types.ts`**

```ts
export const SOURCE_CAPABILITY = "source:v1" as const;

export type SourceKind = "git" | "tarball" | "local";

export type SourceErrorCode =
  | "INVALID_REF"
  | "NOT_MATERIALIZED"
  | "NETWORK"
  | "DIRTY"
  | "UNSUPPORTED_KIND"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface SourceLocation {
  kind: SourceKind;
  host?: string;
  org?: string;
  repo?: string;
  ref?: string;
  path: string;
}

export interface MaterializeOptions {
  cacheRoot?: string;
  staleSeconds?: number;
  filter?: "blob:none" | "tree:0" | "none";
  force?: boolean;
  offline?: boolean;
  ref?: string;
}

export type MaterializeAction =
  | "cloned"
  | "reused"
  | "fetched"
  | "fast-forwarded"
  | "linked"
  | "noop";

export interface MaterializeResult {
  location: SourceLocation;
  action: MaterializeAction;
  head?: string;
  stale: boolean;
}

export interface SourceStatus {
  kind: SourceKind;
  materialized: boolean;
  path?: string;
  stale?: boolean;
  clean?: boolean;
  head?: string;
  lastFetchedAt?: string;
}

export interface SourceTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: typeof SOURCE_CAPABILITY;
  operation: "resolve" | "materialize" | "status" | "refresh";
  kind?: SourceKind;
  durationMs: number;
  ok: boolean;
  errorCode?: SourceErrorCode;
}

export interface SourceProvider {
  readonly pluginId: string;
  readonly capability: typeof SOURCE_CAPABILITY;
  readonly kinds: readonly SourceKind[];
  resolve(ref: string): Promise<SourceLocation>;
  materialize(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
  status(ref: string): Promise<SourceStatus>;
  refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
}

export interface SourceConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
```

- [ ] **Step 4: Create `src/schema.ts`** (pure runtime validators used by conformance)

```ts
import type { MaterializeAction, MaterializeResult, SourceLocation } from "./types.js";

const ACTIONS: ReadonlySet<MaterializeAction> = new Set([
  "cloned", "reused", "fetched", "fast-forwarded", "linked", "noop",
]);

export function isSourceLocation(value: unknown): value is SourceLocation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "git" || v.kind === "tarball" || v.kind === "local") &&
    typeof v.path === "string" &&
    v.path.length > 0
  );
}

export function isMaterializeResult(value: unknown): value is MaterializeResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isSourceLocation(v.location) &&
    typeof v.action === "string" &&
    ACTIONS.has(v.action as MaterializeAction) &&
    typeof v.stale === "boolean"
  );
}
```

- [ ] **Step 5: Create `src/index.ts`**

```ts
export { runSourceV1Conformance } from "./conformance.js";
export { createInMemorySourceProvider } from "./in-memory.js";
export * from "./schema.js";
export * from "./types.js";
```

(`conformance.ts` and `in-memory.ts` are created in Task 2; the build in this task will fail until then, so do NOT run `build` yet — only `type-check` after Task 2. Create a minimal `README.md` with the package name and a one-line description.)

- [ ] **Step 6: Create `README.md`**

```markdown
# @refarm.dev/source-contract-v1

Versioned `source:v1` capability contract — the "librarian". Defines `SourceProvider`
(resolve / materialize / status / refresh) for obtaining a stable local copy of a remote
source. Ships types, a conformance runner, and an in-memory reference implementation.
Zero runtime dependencies.
```

- [ ] **Step 7: Install workspace links**

Run: `pnpm install`
Expected: completes; `@refarm.dev/source-contract-v1` linked into the workspace.

- [ ] **Step 8: Commit**

```bash
git add packages/source-contract-v1
git commit -m "feat(source-contract-v1): scaffold package and source:v1 types"
```

---

### Task 2: In-memory reference + conformance runner (TDD)

**Files:**
- Create: `packages/source-contract-v1/src/conformance.ts`
- Create: `packages/source-contract-v1/src/in-memory.ts`
- Create: `packages/source-contract-v1/src/conformance.test.ts`
- Modify: `scripts/ci/test-capabilities.mjs` (add the package to `STEPS`)

**Interfaces:**
- Consumes: all types from `types.ts`, `isSourceLocation`/`isMaterializeResult` from `schema.ts`.
- Produces: `runSourceV1Conformance(provider: SourceProvider, sampleRef?: string): Promise<SourceConformanceResult>`; `createInMemorySourceProvider(): SourceProvider` (kinds `["local"]`).

- [ ] **Step 1: Write the failing test** — `src/conformance.test.ts`

```ts
import { describe, expect, it } from "vitest";

import {
  SOURCE_CAPABILITY,
  createInMemorySourceProvider,
  runSourceV1Conformance,
  type SourceProvider,
} from "./index.js";

describe("source:v1 conformance", () => {
  it("passes for the in-memory reference provider", async () => {
    const provider = createInMemorySourceProvider();
    const result = await runSourceV1Conformance(provider);
    expect(result.pass).toBe(true);
    expect(result.total).toBe(7);
    expect(result.failed).toBe(0);
  });

  it("reports actionable failures for an incompatible provider", async () => {
    const broken: SourceProvider = {
      pluginId: "",
      capability: "source:v0" as typeof SOURCE_CAPABILITY,
      kinds: [],
      resolve: async () => ({ kind: "local", path: "" }),
      materialize: async () => {
        throw new Error("backend unavailable");
      },
      status: async () => ({ kind: "local", materialized: false }),
      refresh: async () => {
        throw new Error("backend unavailable");
      },
    };
    const result = await runSourceV1Conformance(broken, "local:/x");
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("provider.capability must be 'source:v1'");
    expect(result.failures).toContain("provider.pluginId must be a non-empty string");
    expect(result.failures).toContain("provider.kinds must be non-empty");
    expect(result.failures.some((f) => f.includes("materialize() threw"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/source-contract-v1 run test:unit`
Expected: FAIL — cannot resolve `./conformance.js` / `./in-memory.js` (not created yet).

- [ ] **Step 3: Create `src/in-memory.ts`** (kind `local` over an in-memory Set)

```ts
import type {
  MaterializeOptions,
  MaterializeResult,
  SourceLocation,
  SourceProvider,
  SourceStatus,
} from "./types.js";
import { SOURCE_CAPABILITY } from "./types.js";

function parseLocal(ref: string): string {
  return ref.startsWith("local:") ? ref.slice("local:".length) : ref;
}

export function createInMemorySourceProvider(): SourceProvider {
  const present = new Set<string>();

  async function resolve(ref: string): Promise<SourceLocation> {
    return { kind: "local", path: parseLocal(ref) };
  }

  async function materialize(
    ref: string,
    _opts?: MaterializeOptions,
  ): Promise<MaterializeResult> {
    const path = parseLocal(ref);
    const already = present.has(path);
    present.add(path);
    return {
      location: { kind: "local", path },
      action: already ? "noop" : "linked",
      stale: false,
    };
  }

  return {
    pluginId: "@refarm.dev/source-memory-test",
    capability: SOURCE_CAPABILITY,
    kinds: ["local"],
    resolve,
    materialize,
    async status(ref: string): Promise<SourceStatus> {
      const path = parseLocal(ref);
      return { kind: "local", materialized: present.has(path), path };
    },
    async refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult> {
      return materialize(ref, { ...opts, force: true });
    },
  };
}
```

- [ ] **Step 4: Create `src/conformance.ts`** (7 validations)

```ts
import { isMaterializeResult } from "./schema.js";
import {
  SOURCE_CAPABILITY,
  type SourceConformanceResult,
  type SourceProvider,
} from "./types.js";

const DEFAULT_SAMPLE_REF = "local:/__source_conformance__/sample";

export async function runSourceV1Conformance(
  provider: SourceProvider,
  sampleRef: string = DEFAULT_SAMPLE_REF,
): Promise<SourceConformanceResult> {
  const failures: string[] = [];

  // 1
  if (provider.capability !== SOURCE_CAPABILITY) {
    failures.push("provider.capability must be 'source:v1'");
  }
  // 2
  if (!provider.pluginId || provider.pluginId.trim().length === 0) {
    failures.push("provider.pluginId must be a non-empty string");
  }
  // 3
  if (!Array.isArray(provider.kinds) || provider.kinds.length === 0) {
    failures.push("provider.kinds must be non-empty");
  }

  // 4 — resolve is deterministic and IO-free
  try {
    const a = await provider.resolve(sampleRef);
    const b = await provider.resolve(sampleRef);
    if (a.path !== b.path) {
      failures.push("resolve() must return the same path for the same ref");
    }
  } catch (error) {
    failures.push(`resolve() threw: ${String(error)}`);
  }

  // 5 — materialize returns a valid result
  let materializedPath: string | undefined;
  try {
    const result = await provider.materialize(sampleRef);
    if (!isMaterializeResult(result)) {
      failures.push("materialize() must return a valid MaterializeResult");
    } else {
      materializedPath = result.location.path;
    }
  } catch (error) {
    failures.push(`materialize() threw: ${String(error)}`);
  }

  // 6 — status reflects materialization
  try {
    const status = await provider.status(sampleRef);
    if (!status.materialized) {
      failures.push("status() must report materialized=true after materialize()");
    }
    if (materializedPath && status.path && status.path !== materializedPath) {
      failures.push("status().path must match materialize() location.path");
    }
  } catch (error) {
    failures.push(`status() threw: ${String(error)}`);
  }

  // 7 — refresh returns a valid result
  try {
    const refreshed = await provider.refresh(sampleRef);
    if (!isMaterializeResult(refreshed)) {
      failures.push("refresh() must return a valid MaterializeResult");
    }
  } catch (error) {
    failures.push(`refresh() threw: ${String(error)}`);
  }

  const failed = failures.length;
  return { pass: failed === 0, total: 7, failed, failures };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/source-contract-v1 run test:unit`
Expected: PASS — both tests green; first asserts `total === 7`, `pass === true`.

- [ ] **Step 6: Type-check the package**

Run: `pnpm -C packages/source-contract-v1 run type-check`
Expected: PASS (no errors).

- [ ] **Step 7: Register in BOTH gate lists** — edit `scripts/ci/test-capabilities.mjs` AND `scripts/ci/gate-smoke-contracts.mjs`

In `scripts/ci/test-capabilities.mjs`, add to the `STEPS` array after `["packages/session-contract-v1", "test:unit"],`:

```js
	["packages/source-contract-v1", "test:unit"],
```

In `scripts/ci/gate-smoke-contracts.mjs`, add to its `STEPS` array (a **separate** list — easy to miss) after the `["packages/session-contract-v1", "test:unit"],` entry:

```js
	["packages/source-contract-v1", "build"],
	["packages/source-contract-v1", "test:unit"],
```

See `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md` — a new package must clear both lists or `gate:full:colony` fails.

- [ ] **Step 8: Run the capabilities gate**

Run: `pnpm run test:capabilities`
Expected: PASS — output includes a `[test:capabilities]` line for `packages/source-contract-v1`.

- [ ] **Step 9: Commit**

```bash
git add packages/source-contract-v1/src scripts/ci/test-capabilities.mjs
git commit -m "feat(source-contract-v1): in-memory reference and source:v1 conformance (7 checks)"
```

---

### Task 3: `source-git` ref parsing (TDD)

**Files:**
- Create: `packages/source-git/package.json`
- Create: `packages/source-git/tsconfig.json`
- Create: `packages/source-git/tsconfig.build.json`
- Create: `packages/source-git/vitest.config.ts`
- Create: `packages/source-git/eslint.config.mjs`
- Create: `packages/source-git/src/parse.ts`
- Create: `packages/source-git/src/parse.test.ts`
- Create: `packages/source-git/README.md`

**Interfaces:**
- Consumes: `SourceKind`, `SourceLocation` from `@refarm.dev/source-contract-v1`.
- Produces: `parseSourceRef(ref: string): ParsedRef` and `cachePathFor(parsed: ParsedRef, cacheRoot: string): string` and `defaultCacheRoot(): string`, where `ParsedRef = { kind: SourceKind; host?: string; org?: string; repo?: string; gitref?: string }`.

- [ ] **Step 1: Create the package config files**

`package.json`:
```json
{
	"name": "@refarm.dev/source-git",
	"version": "0.1.0",
	"description": "Git implementation of the source:v1 capability — cached partial-clone checkouts",
	"type": "module",
	"main": "./dist/index.js",
	"types": "./dist/index.d.ts",
	"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
	"scripts": {
		"build": "tsc --project tsconfig.build.json",
		"lint": "eslint src",
		"type-check": "tsc --noEmit",
		"test": "vitest run",
		"test:unit": "vitest run",
		"clean": "rm -rf dist",
		"test:conformance": "vitest run src/provider.test.ts"
	},
	"keywords": ["plugin", "capability", "source", "git", "checkout"],
	"author": "Refarm Contributors",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "https://github.com/aretw0/refarm.git",
		"directory": "packages/source-git"
	},
	"bugs": { "url": "https://github.com/aretw0/refarm/issues" },
	"homepage": "https://refarm.dev.br",
	"files": ["dist", "README.md"],
	"publishConfig": { "access": "public" },
	"dependencies": {
		"@refarm.dev/source-contract-v1": "workspace:*"
	},
	"devDependencies": {
		"@refarm.dev/eslint-config": "workspace:*",
		"@refarm.dev/tsconfig": "workspace:*",
		"@refarm.dev/vtconfig": "workspace:*"
	}
}
```

`tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `eslint.config.mjs`: identical to Task 1 Step 2 (copy the four files verbatim into `packages/source-git/`).

`README.md`:
```markdown
# @refarm.dev/source-git

Git implementation of the `source:v1` capability. Caches partial clones under
`~/.cache/checkouts/<host>/<org>/<repo>`, reuses them, fetches when stale, and
fast-forwards when clean. Depends only on `git` in PATH.
```

- [ ] **Step 2: Write the failing test** — `src/parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { cachePathFor, parseSourceRef } from "./parse.js";

describe("parseSourceRef", () => {
  it("defaults owner/repo to github.com", () => {
    expect(parseSourceRef("aretw0/agents-lab")).toEqual({
      kind: "git", host: "github.com", org: "aretw0", repo: "agents-lab",
    });
  });

  it("parses host/org/repo", () => {
    expect(parseSourceRef("gitlab.com/acme/widget")).toEqual({
      kind: "git", host: "gitlab.com", org: "acme", repo: "widget",
    });
  });

  it("parses https URLs and strips .git", () => {
    expect(parseSourceRef("https://github.com/mitsuhiko/minijinja")).toEqual({
      kind: "git", host: "github.com", org: "mitsuhiko", repo: "minijinja",
    });
    expect(parseSourceRef("https://github.com/mitsuhiko/minijinja.git")).toEqual({
      kind: "git", host: "github.com", org: "mitsuhiko", repo: "minijinja",
    });
  });

  it("parses scp-like git@ syntax", () => {
    expect(parseSourceRef("git@github.com:mitsuhiko/minijinja.git")).toEqual({
      kind: "git", host: "github.com", org: "mitsuhiko", repo: "minijinja",
    });
  });

  it("treats local: prefix as kind local", () => {
    expect(parseSourceRef("local:/home/me/repo")).toEqual({
      kind: "local", repo: "repo",
    });
  });

  it("treats a filesystem path ending in .git as a local git remote", () => {
    expect(parseSourceRef("/tmp/sample.git")).toEqual({
      kind: "git", host: "local", org: "_", repo: "sample",
    });
  });

  it("throws INVALID_REF marker on empty input", () => {
    expect(() => parseSourceRef("")).toThrow(/INVALID_REF/);
  });

  it("builds a deterministic git cache path", () => {
    const parsed = parseSourceRef("aretw0/agents-lab");
    expect(cachePathFor(parsed, "/cache")).toBe("/cache/github.com/aretw0/agents-lab");
  });

  it("returns the path itself for local kind", () => {
    const parsed = parseSourceRef("local:/home/me/repo");
    expect(cachePathFor(parsed, "/cache")).toBe("/home/me/repo");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/source-git run test:unit`
Expected: FAIL — `./parse.js` does not exist.

- [ ] **Step 4: Create `src/parse.ts`**

```ts
import os from "node:os";
import path from "node:path";
import type { SourceKind } from "@refarm.dev/source-contract-v1";

export interface ParsedRef {
  kind: SourceKind;
  host?: string;
  org?: string;
  repo?: string;
  gitref?: string;
}

function stripGitSuffix(s: string): string {
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}

export function parseSourceRef(ref: string): ParsedRef {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new Error("INVALID_REF: empty ref");
  }

  // local:<path>
  if (trimmed.startsWith("local:")) {
    const p = trimmed.slice("local:".length);
    return { kind: "local", repo: path.basename(stripGitSuffix(p)) };
  }

  // scp-like: git@host:org/repo(.git)
  const scp = /^git@([^:]+):([^/]+)\/(.+)$/.exec(trimmed);
  if (scp) {
    return { kind: "git", host: scp[1], org: scp[2], repo: stripGitSuffix(scp[3]) };
  }

  // URL: https://host/org/repo(.git)
  if (/^https?:\/\//.test(trimmed)) {
    const u = new URL(trimmed);
    const segs = u.pathname.replace(/^\/+/, "").split("/");
    if (segs.length < 2) throw new Error(`INVALID_REF: ${ref}`);
    return { kind: "git", host: u.host, org: segs[0], repo: stripGitSuffix(segs[1]) };
  }

  // filesystem path or file:// ending in .git → local git remote (used by tests)
  if (trimmed.startsWith("file://") || trimmed.startsWith("/") || trimmed.endsWith(".git")) {
    const base = path.basename(stripGitSuffix(trimmed.replace(/^file:\/\//, "")));
    return { kind: "git", host: "local", org: "_", repo: base };
  }

  // owner/repo or host/org/repo
  const segs = stripGitSuffix(trimmed).split("/");
  if (segs.length === 2) {
    return { kind: "git", host: "github.com", org: segs[0], repo: segs[1] };
  }
  if (segs.length === 3) {
    return { kind: "git", host: segs[0], org: segs[1], repo: segs[2] };
  }
  throw new Error(`INVALID_REF: ${ref}`);
}

export function defaultCacheRoot(): string {
  return path.join(os.homedir(), ".cache", "checkouts");
}

export function cachePathFor(parsed: ParsedRef, cacheRoot: string): string {
  if (parsed.kind === "local") {
    throw new Error("cachePathFor: local kind has no cache path; use the source path");
  }
  return path.join(cacheRoot, parsed.host ?? "unknown", parsed.org ?? "_", parsed.repo ?? "_");
}
```

Note: the `local` cache-path test in Step 2 expects `cachePathFor` to return the source path. Adjust the local branch of `cachePathFor` to return the original path instead of throwing — replace the `if (parsed.kind === "local")` block with: it needs the source path, which `ParsedRef` does not carry. Resolve this in Step 4a.

- [ ] **Step 4a: Carry the local path so `cachePathFor` is total**

Add `sourcePath?: string` to `ParsedRef`, set it in the `local:` branch (`sourcePath: stripGitSuffix(p)` → actually keep the raw `p`), and return it from `cachePathFor`:

```ts
// in ParsedRef:
//   sourcePath?: string;   // populated for kind "local"

// in the local: branch of parseSourceRef:
//   return { kind: "local", repo: path.basename(stripGitSuffix(p)), sourcePath: p };

// in cachePathFor:
//   if (parsed.kind === "local") return parsed.sourcePath ?? "";
```

Update `parse.test.ts` expectations: the `local:` parse case becomes
`{ kind: "local", repo: "repo", sourcePath: "/home/me/repo" }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/source-git run test:unit`
Expected: PASS — all `parseSourceRef` and `cachePathFor` cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/source-git
git commit -m "feat(source-git): ref parsing and deterministic cache paths"
```

---

### Task 4: `source-git` provider — materialize/status/refresh (TDD against a local bare repo)

**Files:**
- Create: `packages/source-git/src/git.ts`
- Create: `packages/source-git/src/provider.ts`
- Create: `packages/source-git/src/index.ts`
- Create: `packages/source-git/src/provider.test.ts`
- Modify: `scripts/ci/test-capabilities.mjs` (add `source-git` conformance step)

**Interfaces:**
- Consumes: `parseSourceRef`, `cachePathFor`, `defaultCacheRoot` from `./parse.js`; `SourceProvider`, `MaterializeOptions`, `MaterializeResult`, `SourceStatus`, `SourceLocation`, `SOURCE_CAPABILITY`, `runSourceV1Conformance` from `@refarm.dev/source-contract-v1`.
- Produces: `createGitSourceProvider(opts?: { cacheRoot?: string; pluginId?: string }): SourceProvider`.

- [ ] **Step 1: Create `src/git.ts`** (thin async wrappers over the `git` binary)

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await pexec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function partialClone(
  remote: string,
  dest: string,
  filter: string,
): Promise<void> {
  const args = ["clone"];
  if (filter !== "none") args.push(`--filter=${filter}`);
  args.push(remote, dest);
  await git(args);
}

export async function headCommit(repo: string): Promise<string> {
  return git(["rev-parse", "HEAD"], repo);
}

export async function isClean(repo: string): Promise<boolean> {
  const out = await git(["status", "--porcelain"], repo);
  return out.length === 0;
}

export async function hasUpstream(repo: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repo);
    return true;
  } catch {
    return false;
  }
}

export async function fetchAndMaybeFastForward(repo: string): Promise<"fetched" | "fast-forwarded"> {
  await git(["fetch", "origin"], repo);
  if ((await isClean(repo)) && (await hasUpstream(repo))) {
    await git(["merge", "--ff-only", "@{u}"], repo);
    return "fast-forwarded";
  }
  return "fetched";
}
```

- [ ] **Step 2: Write the failing test** — `src/provider.test.ts`

```ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSourceV1Conformance } from "@refarm.dev/source-contract-v1";
import { createGitSourceProvider } from "./index.js";

const pexec = promisify(execFile);
async function g(args: string[], cwd?: string) {
  await pexec("git", args, { cwd });
}

let sampleRepo: string;   // a real git repo we clone from (local filesystem remote)
let cacheRoot: string;

beforeAll(async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "source-git-"));
  sampleRepo = path.join(tmp, "sample");
  cacheRoot = path.join(tmp, "cache");
  await g(["init", sampleRepo]);
  await g(["-C", sampleRepo, "config", "user.email", "t@t.dev"]);
  await g(["-C", sampleRepo, "config", "user.name", "Test"]);
  await writeFile(path.join(sampleRepo, "README.md"), "# sample\n");
  await g(["-C", sampleRepo, "add", "."]);
  await g(["-C", sampleRepo, "commit", "-m", "init"]);
});

describe("source-git provider", () => {
  it("passes source:v1 conformance against a local git remote", async () => {
    const provider = createGitSourceProvider({ cacheRoot });
    const result = await runSourceV1Conformance(provider, sampleRepo);
    expect(result.pass).toBe(true);
    expect(result.failed).toBe(0);
  });

  it("clones on first materialize and reuses on second", async () => {
    const provider = createGitSourceProvider({ cacheRoot });
    const first = await provider.materialize(sampleRepo, { staleSeconds: 300 });
    expect(["cloned", "reused"]).toContain(first.action);
    const second = await provider.materialize(sampleRepo, { staleSeconds: 300 });
    expect(second.action).toBe("reused");
    const status = await provider.status(sampleRepo);
    expect(status.materialized).toBe(true);
    expect(status.clean).toBe(true);
    expect(typeof status.head).toBe("string");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/source-git run test:unit`
Expected: FAIL — `createGitSourceProvider` not exported from `./index.js`.

- [ ] **Step 4: Create `src/provider.ts`**

```ts
import { existsSync, statSync } from "node:fs";
import {
  SOURCE_CAPABILITY,
  type MaterializeOptions,
  type MaterializeResult,
  type SourceLocation,
  type SourceProvider,
  type SourceStatus,
} from "@refarm.dev/source-contract-v1";

import { cachePathFor, defaultCacheRoot, parseSourceRef, type ParsedRef } from "./parse.js";
import { fetchAndMaybeFastForward, headCommit, isClean, partialClone } from "./git.js";

const DEFAULT_STALE_SECONDS = 300;
const DEFAULT_FILTER = "blob:none";

export interface GitSourceProviderOptions {
  cacheRoot?: string;
  pluginId?: string;
}

export function createGitSourceProvider(opts: GitSourceProviderOptions = {}): SourceProvider {
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();

  function locate(ref: string): { parsed: ParsedRef; path: string } {
    const parsed = parseSourceRef(ref);
    if (parsed.kind !== "git") {
      throw new Error("UNSUPPORTED_KIND: source-git only supports kind 'git'");
    }
    return { parsed, path: cachePathFor(parsed, cacheRoot) };
  }

  function locationOf(parsed: ParsedRef, p: string): SourceLocation {
    return { kind: "git", host: parsed.host, org: parsed.org, repo: parsed.repo, path: p };
  }

  function isStale(p: string, staleSeconds: number): boolean {
    try {
      const ageMs = Date.now() - statSync(path.join(p, ".git")).mtimeMs;
      return ageMs > staleSeconds * 1000;
    } catch {
      return true;
    }
  }

  async function materialize(
    ref: string,
    options?: MaterializeOptions,
  ): Promise<MaterializeResult> {
    const { parsed, path: dest } = locate(ref);
    const filter = options?.filter ?? DEFAULT_FILTER;
    const staleSeconds = options?.staleSeconds ?? DEFAULT_STALE_SECONDS;
    const location = locationOf(parsed, dest);

    if (!existsSync(dest)) {
      await partialClone(ref, dest, filter);
      return { location, action: "cloned", head: await headCommit(dest), stale: false };
    }

    const stale = options?.force === true || isStale(dest, staleSeconds);
    if (!stale) {
      return { location, action: "reused", head: await headCommit(dest), stale: false };
    }
    if (options?.offline === true) {
      return { location, action: "noop", head: await headCommit(dest), stale: true };
    }
    const action = await fetchAndMaybeFastForward(dest);
    return { location, action, head: await headCommit(dest), stale: true };
  }

  return {
    pluginId: opts.pluginId ?? "@refarm.dev/source-git",
    capability: SOURCE_CAPABILITY,
    kinds: ["git"],

    async resolve(ref: string): Promise<SourceLocation> {
      const { parsed, path: p } = locate(ref);
      return locationOf(parsed, p);
    },

    materialize,

    async status(ref: string): Promise<SourceStatus> {
      const { path: dest } = locate(ref);
      if (!existsSync(dest)) {
        return { kind: "git", materialized: false, path: dest };
      }
      return {
        kind: "git",
        materialized: true,
        path: dest,
        clean: await isClean(dest),
        head: await headCommit(dest),
      };
    },

    async refresh(ref: string, options?: MaterializeOptions): Promise<MaterializeResult> {
      return materialize(ref, { ...options, force: true });
    },
  };
}

import path from "node:path";
```

(Move the `import path from "node:path";` to the top of the file with the other imports — it is shown last only for visibility.)

- [ ] **Step 5: Create `src/index.ts`**

```ts
export { createGitSourceProvider, type GitSourceProviderOptions } from "./provider.js";
export { parseSourceRef, cachePathFor, defaultCacheRoot, type ParsedRef } from "./parse.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -C packages/source-git run test:unit`
Expected: PASS — conformance passes against the local bare remote; clone-then-reuse assertions green. (Requires `git` in PATH — present in the devcontainer.)

- [ ] **Step 7: Type-check**

Run: `pnpm -C packages/source-git run type-check`
Expected: PASS.

- [ ] **Step 8: Register source-git in BOTH gate lists** — edit `scripts/ci/test-capabilities.mjs` AND `scripts/ci/gate-smoke-contracts.mjs`

In `scripts/ci/test-capabilities.mjs`, add to `STEPS` after `["packages/identity-nostr", "test:conformance"],`:

```js
	["packages/source-git", "test:conformance"],
```

In `scripts/ci/gate-smoke-contracts.mjs`, add to its `STEPS` after the `sync-loro` entries:

```js
	["packages/source-git", "build"],
	["packages/source-git", "test:conformance"],
```

- [ ] **Step 9: Run the capabilities gate**

Run: `pnpm run test:capabilities`
Expected: PASS — includes `packages/source-contract-v1` and `packages/source-git` steps.

- [ ] **Step 10: Commit**

```bash
git add packages/source-git/src scripts/ci/test-capabilities.mjs
git commit -m "feat(source-git): git provider with cached partial clone, status, refresh"
```

---

### Task 5: Dogfood smoke — Refarm materializes a real repo and reads it

**Files:**
- Create: `scripts/ci/smoke-source-git-librarian.mjs`
- Modify: `package.json` (root) — add a `source:librarian:smoke` script

**Interfaces:**
- Consumes: `createGitSourceProvider` from the built `@refarm.dev/source-git`.

- [ ] **Step 1: Build the two packages**

Run: `pnpm -C packages/source-contract-v1 run build && pnpm -C packages/source-git run build`
Expected: PASS — `dist/` produced for both.

- [ ] **Step 2: Create `scripts/ci/smoke-source-git-librarian.mjs`**

```js
#!/usr/bin/env node
// Dogfood: Refarm uses source:v1 (git) to materialize a real repo and read it.
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitSourceProvider } from "@refarm.dev/source-git";

const REF = process.env.SMOKE_SOURCE_REF ?? "aretw0/agents-lab";
const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "librarian-smoke-"));
const provider = createGitSourceProvider({ cacheRoot });

const first = await provider.materialize(REF, { filter: "blob:none" });
if (first.action !== "cloned") {
  throw new Error(`expected first action 'cloned', got '${first.action}'`);
}

const status = await provider.status(REF);
if (!status.materialized || !status.path) {
  throw new Error("expected materialized status with a path");
}

// Read a file from the materialized checkout (proves inspection works).
const readme = readFileSync(path.join(status.path, "README.md"), "utf8");
if (readme.length === 0) {
  throw new Error("expected non-empty README.md in materialized repo");
}

const second = await provider.materialize(REF, { staleSeconds: 300 });
if (second.action !== "reused") {
  throw new Error(`expected second action 'reused', got '${second.action}'`);
}

console.log(`[librarian smoke] OK — ${REF} materialized at ${status.path} (head ${status.head})`);
```

- [ ] **Step 3: Add the root script** — edit `package.json`, add to `scripts` (after `"test:capabilities"`):

```json
		"source:librarian:smoke": "node scripts/ci/smoke-source-git-librarian.mjs",
```

- [ ] **Step 4: Run the dogfood smoke** (needs network)

Run: `pnpm run source:librarian:smoke`
Expected: PASS — prints `[librarian smoke] OK — aretw0/agents-lab materialized at <path> (head <sha>)`.

- [ ] **Step 5: Run the intermediate offline check**

Run: `node -e "import('@refarm.dev/source-git').then(async m => { const p = m.createGitSourceProvider({cacheRoot:'/x'}); const a = await p.resolve('aretw0/agents-lab'); const b = await p.resolve('aretw0/agents-lab'); if (a.path !== b.path) { throw new Error('resolve not deterministic'); } console.log('[offline] resolve deterministic:', a.path); })"`
Expected: PASS — prints the same deterministic path, no network used.

- [ ] **Step 6: Final gate — lint + type-check + capabilities**

Run: `pnpm -C packages/source-contract-v1 run lint && pnpm -C packages/source-git run lint && pnpm run test:capabilities`
Expected: PASS — all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/ci/smoke-source-git-librarian.mjs package.json
git commit -m "feat(source-git): dogfood smoke — Refarm materializes and reads a real repo"
```

---

### Task 6: Package acceptance — release entry + colony-subset gate

**Files:**
- Create: `.changeset/source-capability.md`
- Verify only: `scripts/validate-packages.mjs`, `scripts/ci/gate-smoke-contracts.mjs` outputs

**Interfaces:** none (integration/release wiring).

- [ ] **Step 1: Add a changeset for the two publishable packages**

Create `.changeset/source-capability.md` (model: `.changeset/initial-contracts-release.md`):

```markdown
---
"@refarm.dev/source-contract-v1": minor
"@refarm.dev/source-git": minor
---

Add the source:v1 capability (the librarian): contract + git provider for cached partial-clone checkouts.
```

- [ ] **Step 2: Validate package scaffolds**

Run: `pnpm run validate-packages`
Expected: PASS — `source-contract-v1` classifies as `contract-v1`, `source-git` as a buildable/adapter. If either is flagged, fix the `package.json` to match the canonical type (see `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`) or add `"scaffold": { "type": "exempt", "reason": "..." }`.

- [ ] **Step 3: Run the colony-subset gates**

Run: `pnpm run gate:smoke:contracts && pnpm run test:capabilities && pnpm run task:build-order:check && pnpm run workspace:source:ownership`
Expected: PASS — all four; the two new packages appear in the contracts-smoke and capabilities output.

- [ ] **Step 4: Commit**

```bash
# test-capabilities.mjs was already committed in Tasks 2 & 4; gate-smoke-contracts.mjs edits
# (Task 2 Step 7, Task 4 Step 8) are still pending and land here with the changeset.
git add .changeset/source-capability.md scripts/ci/gate-smoke-contracts.mjs
git commit -m "chore(source): register source:v1 packages in release + acceptance gates"
```

---

## Self-Review

**Spec coverage:**
- §1 interface → Task 1 (types.ts). ✓
- §2 reference impl (in-memory, local) → Task 2 (in-memory.ts). ✓
- §3 conformance runner (7 checks) → Task 2 (conformance.ts + test). ✓
- §4 real git impl (resolve/materialize/status/refresh, partial clone, cache path, ff) → Tasks 3–4. ✓
- §5 package layout (contract + git, no dispatch dep) → Tasks 1, 3; `source-git` deps only `source-contract-v1`. ✓
- §6 ref parsing & cache semantics → Task 3. ✓
- §7 first consumer dogfood (materialize + read) → Task 5. ✓
- §8 verification plan (capabilities gate, offline check, network smoke, final gate) → Tasks 2/4 Step "capabilities", Task 5 Steps 4–6. ✓
- §9/§10 deferred (`source-dispatch`, `source-local`, `tarball`, `dgk`) → explicitly excluded in Global Constraints. ✓

**Placeholder scan:** No TBD/TODO. Task 3 Step 4/4a deliberately splits the `cachePathFor` local-path fix into an explicit follow-up step with the exact diff, not a vague "handle local."

**Type consistency:** `createGitSourceProvider` named identically in Task 4 provider.ts, index.ts, and Task 5 smoke. `runSourceV1Conformance(provider, sampleRef?)` signature consistent between Task 2 (definition) and Task 4 (git call with `sampleRepo`). `ParsedRef` gains `sourcePath?` in Task 3 Step 4a and is consumed by `cachePathFor` consistently. `parseSourceRef`/`cachePathFor`/`defaultCacheRoot` exported from `source-git` index and used by provider.
