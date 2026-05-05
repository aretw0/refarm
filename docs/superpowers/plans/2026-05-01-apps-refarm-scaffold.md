# apps/refarm Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/refarm` as the canonical Refarm CLI binary, migrate all commands from `packages/cli` with a TDD gate per command, and deliver `refarm status --json` powered by a headless Tractor probe.

**Architecture:** `packages/cli` becomes a library-only package exporting `buildRefarmStatusJson` and related types. `apps/refarm` becomes the Commander binary owning all command implementations. Two structural adapter functions added to `packages/runtime` and `packages/trust` bridge Tractor boot state to domain summaries without adding tractor as a dependency (duck typing via local interfaces).

**Tech Stack:** TypeScript ESM, Commander 14, Vitest 4, `@refarm.dev/tractor`, `@refarm.dev/homestead`, chalk, inquirer, `@refarm.dev/vtconfig` + `@refarm.dev/tsconfig`.

---

## File Map

**Create:**
- `packages/runtime/src/tractor-adapter.ts` — `createRuntimeSummaryFromTractor`
- `packages/runtime/test/tractor-adapter.test.ts`
- `packages/trust/src/tractor-adapter.ts` — `createTrustSummaryFromTractor`
- `packages/trust/test/tractor-adapter.test.ts`
- `apps/refarm/package.json`
- `apps/refarm/tsconfig.json`
- `apps/refarm/tsconfig.build.json`
- `apps/refarm/vitest.config.ts`
- `apps/refarm/src/index.ts`
- `apps/refarm/src/program.ts`
- `apps/refarm/src/renderers.ts`
- `apps/refarm/src/commands/init.ts`
- `apps/refarm/src/commands/sow.ts`
- `apps/refarm/src/commands/guide.ts`
- `apps/refarm/src/commands/health.ts`
- `apps/refarm/src/commands/migrate.ts`
- `apps/refarm/src/commands/deploy.ts`
- `apps/refarm/src/commands/plugin.ts`
- `apps/refarm/src/commands/status.ts`
- `apps/refarm/test/commands/init.test.ts`
- `apps/refarm/test/commands/sow.test.ts`
- `apps/refarm/test/commands/guide.test.ts`
- `apps/refarm/test/commands/health.test.ts`
- `apps/refarm/test/commands/migrate.test.ts`
- `apps/refarm/test/commands/deploy.test.ts`
- `apps/refarm/test/commands/plugin.test.ts`
- `apps/refarm/test/commands/status.test.ts`

**Modify:**
- `packages/runtime/src/index.ts` — add `createRuntimeSummaryFromTractor` export
- `packages/trust/src/index.ts` — add `createTrustSummaryFromTractor` export

**Delete:**
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/init.test.ts`
- `packages/cli/src/commands/sow.ts`
- `packages/cli/src/commands/guide.ts`
- `packages/cli/src/commands/health.ts`
- `packages/cli/src/commands/migrate.ts`
- `packages/cli/src/commands/deploy.ts`
- `packages/cli/src/commands/plugin.ts`
- `packages/cli/src/commands/plugin.test.ts`
- `packages/cli/src/program.ts`
- `packages/cli/src/index.ts` (replaced with library-only version)

**Modify (strip):**
- `packages/cli/package.json` — remove `bin`, `commander`, `inquirer`, `chalk`, all command deps

---

### Task 1: RuntimeSummary adapter in packages/runtime

**Files:**
- Create: `packages/runtime/src/tractor-adapter.ts`
- Create: `packages/runtime/test/tractor-adapter.test.ts`
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/test/tractor-adapter.test.ts
import { describe, it, expect } from "vitest";
import { createRuntimeSummaryFromTractor } from "../src/tractor-adapter.js";

describe("createRuntimeSummaryFromTractor", () => {
  it("returns ready:true with namespace from tractor", () => {
    const fakeTractor = { namespace: "refarm-main" };
    const result = createRuntimeSummaryFromTractor(fakeTractor);
    expect(result.ready).toBe(true);
    expect(result.namespace).toBe("refarm-main");
    expect(result.databaseName).toBe("refarm-main");
  });

  it("uses namespace as databaseName", () => {
    const fakeTractor = { namespace: "studio-dev" };
    const result = createRuntimeSummaryFromTractor(fakeTractor);
    expect(result.databaseName).toBe("studio-dev");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=packages/runtime 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/tractor-adapter.js'`

- [ ] **Step 3: Implement the adapter**

```typescript
// packages/runtime/src/tractor-adapter.ts
import type { RuntimeSummary } from "./index.js";

interface TractorLike {
  namespace: string;
}

export function createRuntimeSummaryFromTractor(tractor: TractorLike): RuntimeSummary {
  return {
    ready: true,
    namespace: tractor.namespace,
    databaseName: tractor.namespace,
  };
}
```

- [ ] **Step 4: Export from index**

```typescript
// packages/runtime/src/index.ts  (append)
export { createRuntimeSummaryFromTractor } from "./tractor-adapter.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test --workspace=packages/runtime 2>&1 | tail -10
```

Expected: `Tests  3 passed (3)`

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/tractor-adapter.ts packages/runtime/src/index.ts packages/runtime/test/tractor-adapter.test.ts
git commit -m "feat(runtime): add createRuntimeSummaryFromTractor adapter"
```

---

### Task 2: TrustSummary adapter in packages/trust

**Files:**
- Create: `packages/trust/src/tractor-adapter.ts`
- Create: `packages/trust/test/tractor-adapter.test.ts`
- Modify: `packages/trust/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/trust/test/tractor-adapter.test.ts
import { describe, it, expect } from "vitest";
import { createTrustSummaryFromTractor } from "../src/tractor-adapter.js";

describe("createTrustSummaryFromTractor", () => {
  it("uses defaultSecurityMode as profile", () => {
    const fakeTractor = { defaultSecurityMode: "strict" };
    const result = createTrustSummaryFromTractor(fakeTractor);
    expect(result.profile).toBe("strict");
  });

  it("returns zero warnings and critical for a fresh tractor", () => {
    const fakeTractor = { defaultSecurityMode: "permissive" };
    const result = createTrustSummaryFromTractor(fakeTractor);
    expect(result.warnings).toBe(0);
    expect(result.critical).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=packages/trust 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/tractor-adapter.js'`

- [ ] **Step 3: Implement the adapter**

```typescript
// packages/trust/src/tractor-adapter.ts
import type { TrustSummary } from "./index.js";

interface TractorLike {
  defaultSecurityMode: string;
}

export function createTrustSummaryFromTractor(tractor: TractorLike): TrustSummary {
  return {
    profile: tractor.defaultSecurityMode,
    warnings: 0,
    critical: 0,
  };
}
```

- [ ] **Step 4: Export from index**

```typescript
// packages/trust/src/index.ts  (append)
export { createTrustSummaryFromTractor } from "./tractor-adapter.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test --workspace=packages/trust 2>&1 | tail -10
```

Expected: `Tests  4 passed (4)`

- [ ] **Step 6: Commit**

```bash
git add packages/trust/src/tractor-adapter.ts packages/trust/src/index.ts packages/trust/test/tractor-adapter.test.ts
git commit -m "feat(trust): add createTrustSummaryFromTractor adapter"
```

---

### Task 3: Scaffold apps/refarm skeleton

**Files:**
- Create: `apps/refarm/package.json`
- Create: `apps/refarm/tsconfig.json`
- Create: `apps/refarm/tsconfig.build.json`
- Create: `apps/refarm/vitest.config.ts`
- Create: `apps/refarm/src/index.ts`
- Create: `apps/refarm/src/program.ts`
- Create: `apps/refarm/src/renderers.ts`

- [ ] **Step 1: Create package.json**

```json
// apps/refarm/package.json
{
  "name": "@refarm.dev/refarm",
  "version": "0.1.0",
  "description": "Refarm CLI — The Sovereign Farm distro binary.",
  "type": "module",
  "private": true,
  "bin": {
    "refarm": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@refarm.dev/cli": "*",
    "@refarm.dev/config": "*",
    "@refarm.dev/health": "*",
    "@refarm.dev/homestead": "*",
    "@refarm.dev/registry": "*",
    "@refarm.dev/runtime": "*",
    "@refarm.dev/silo": "*",
    "@refarm.dev/sower": "*",
    "@refarm.dev/tractor": "*",
    "@refarm.dev/trust": "*",
    "@refarm.dev/windmill": "*",
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "inquirer": "^13.4.2"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@refarm.dev/vtconfig": "*",
    "@types/inquirer": "^9.0.9"
  },
  "license": "AGPL-3.0-only"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// apps/refarm/tsconfig.json
{
  "extends": "@refarm.dev/tsconfig/node.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

```json
// apps/refarm/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["test"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
// apps/refarm/vitest.config.ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: { alias: getAliases(path.resolve(__dirname, "../../")) },
    test: { environment: "node", include: ["test/**/*.test.ts"] },
  }),
);
```

- [ ] **Step 5: Create renderers.ts**

```typescript
// apps/refarm/src/renderers.ts
import { createHomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";

export const REFARM_HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
  "refarm-headless",
  "headless",
);
```

- [ ] **Step 6: Create empty program.ts and index.ts**

```typescript
// apps/refarm/src/program.ts
import { Command } from "commander";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");
```

```typescript
// apps/refarm/src/index.ts
#!/usr/bin/env node
import { program } from "./program.js";
program.parse();
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

- [ ] **Step 8: Verify type-check passes on empty scaffold**

```bash
npm run type-check --workspace=apps/refarm 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 9: Commit scaffold**

```bash
git add apps/refarm/
git commit -m "feat(refarm): scaffold apps/refarm CLI distro skeleton"
```

---

### Task 4: Migrate init command

**Files:**
- Create: `apps/refarm/src/commands/init.ts` (copied from packages/cli)
- Create: `apps/refarm/test/commands/init.test.ts` (moved from packages/cli)
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/init.ts`
- Delete: `packages/cli/src/commands/init.test.ts`

- [ ] **Step 1: Copy init.ts to apps/refarm/src/commands/init.ts**

Copy `packages/cli/src/commands/init.ts` verbatim to `apps/refarm/src/commands/init.ts`. The imports are identical — no changes needed since all deps are in apps/refarm.

- [ ] **Step 2: Move the test to apps/refarm**

Copy `packages/cli/src/commands/init.test.ts` to `apps/refarm/test/commands/init.test.ts`.

Update the import at the bottom of the test file:

```typescript
// Change:
import { initCommand } from "./init.js";
// To:
import { initCommand } from "../../src/commands/init.js";
```

- [ ] **Step 3: Run test to verify it passes in apps/refarm**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -15
```

Expected: `Tests  4 passed (4)`

- [ ] **Step 4: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts
import { Command } from "commander";
import { initCommand } from "./commands/init.js";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");

program.addCommand(initCommand);
```

- [ ] **Step 5: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/init.ts packages/cli/src/commands/init.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/refarm/src/commands/init.ts apps/refarm/test/commands/init.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate init command from packages/cli"
```

---

### Task 5: Migrate sow command

**Files:**
- Create: `apps/refarm/src/commands/sow.ts`
- Create: `apps/refarm/test/commands/sow.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/sow.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/sow.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSow, mockInquirerPrompt } = vi.hoisted(() => ({
  mockSow: vi.fn().mockResolvedValue({
    storagePath: "/home/user/.refarm/identity.json",
    github: { ok: true, count: 3 },
    cloudflare: { ok: true },
  }),
  mockInquirerPrompt: vi.fn().mockResolvedValue({
    owner: "refarm-dev",
    githubToken: "ghp_test",
    cloudflareToken: "cf_test",
  }),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("@refarm.dev/sower", () => ({
  SowerCore: vi.fn().mockImplementation(function () {
    return { sow: mockSow };
  }),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () { return {}; }),
}));

import { sowCommand } from "../../src/commands/sow.js";

describe("sowCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInquirerPrompt.mockResolvedValue({
      owner: "refarm-dev",
      githubToken: "ghp_test",
      cloudflareToken: "cf_test",
    });
    mockSow.mockResolvedValue({
      storagePath: "/home/user/.refarm/identity.json",
      github: { ok: true, count: 3 },
      cloudflare: { ok: true },
    });
  });

  it("calls sower.sow with tokens from prompt", async () => {
    await sowCommand.parseAsync([], { from: "user" });
    expect(mockSow).toHaveBeenCalledWith(
      expect.objectContaining({ githubToken: "ghp_test", cloudflareToken: "cf_test" }),
      expect.objectContaining({ owner: "refarm-dev" }),
    );
  });

  it("prompts for github token, cloudflare token, and owner", async () => {
    await sowCommand.parseAsync([], { from: "user" });
    expect(mockInquirerPrompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "githubToken" }),
        expect.objectContaining({ name: "cloudflareToken" }),
        expect.objectContaining({ name: "owner" }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/sow.js'`

- [ ] **Step 3: Copy sow.ts to apps/refarm**

Copy `packages/cli/src/commands/sow.ts` verbatim to `apps/refarm/src/commands/sow.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add after init import:
import { sowCommand } from "./commands/sow.js";
// add after program.addCommand(initCommand):
program.addCommand(sowCommand);
```

- [ ] **Step 6: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/sow.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/sow.ts apps/refarm/test/commands/sow.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate sow command from packages/cli"
```

---

### Task 6: Migrate guide command

**Files:**
- Create: `apps/refarm/src/commands/guide.ts`
- Create: `apps/refarm/test/commands/guide.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/guide.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/guide.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProvision, mockWriteFileSync } = vi.hoisted(() => ({
  mockProvision: vi.fn().mockReturnValue({
    REFARM_GITHUB_TOKEN: "ghp_test",
    REFARM_CLOUDFLARE_API_TOKEN: undefined,
  }),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("@refarm.dev/config", () => ({
  loadConfig: vi.fn().mockReturnValue({ brand: { name: "test-farm" } }),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { provision: mockProvision };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
    default: { ...actual.default, writeFileSync: mockWriteFileSync },
  };
});

import { guideCommand } from "../../src/commands/guide.js";

describe("guideCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a markdown file", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".md"),
      expect.stringContaining("# Sovereign"),
    );
  });

  it("reflects token presence in the generated content", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    const content = mockWriteFileSync.mock.calls[0][1] as string;
    expect(content).toContain("GITHUB_TOKEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/guide.js'`

- [ ] **Step 3: Copy guide.ts to apps/refarm**

Copy `packages/cli/src/commands/guide.ts` verbatim to `apps/refarm/src/commands/guide.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { guideCommand } from "./commands/guide.js";
program.addCommand(guideCommand);
```

- [ ] **Step 6: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/guide.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/guide.ts apps/refarm/test/commands/guide.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate guide command from packages/cli"
```

---

### Task 7: Migrate health command

**Files:**
- Create: `apps/refarm/src/commands/health.ts`
- Create: `apps/refarm/test/commands/health.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/health.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/health.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAudit, mockCheckResolutionStatus } = vi.hoisted(() => ({
  mockAudit: vi.fn().mockResolvedValue({ git: [], builds: [], alignment: [] }),
  mockCheckResolutionStatus: vi.fn().mockResolvedValue([]),
}));

vi.mock("@refarm.dev/health", () => ({
  HealthCore: vi.fn().mockImplementation(function () {
    return { register: vi.fn(), audit: mockAudit, checkResolutionStatus: mockCheckResolutionStatus };
  }),
  FileSystemAuditor: vi.fn(),
  RefarmProjectAuditor: vi.fn(),
}));

import { healthCommand } from "../../src/commands/health.js";

describe("healthCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs audit and checkResolutionStatus", async () => {
    await healthCommand.parseAsync([], { from: "user" });
    expect(mockAudit).toHaveBeenCalled();
    expect(mockCheckResolutionStatus).toHaveBeenCalled();
  });

  it("does not throw when all checks pass", async () => {
    await expect(healthCommand.parseAsync([], { from: "user" })).resolves.not.toThrow();
  });

  it("does not throw when health issues are found", async () => {
    mockAudit.mockResolvedValue({
      git: [{ file: "src/missing.ts", type: "ignored" }],
      builds: [],
      alignment: [],
    });
    await expect(healthCommand.parseAsync([], { from: "user" })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/health.js'`

- [ ] **Step 3: Copy health.ts to apps/refarm**

Copy `packages/cli/src/commands/health.ts` verbatim to `apps/refarm/src/commands/health.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { healthCommand } from "./commands/health.js";
program.addCommand(healthCommand);
```

- [ ] **Step 6: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/health.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/health.ts apps/refarm/test/commands/health.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate health command from packages/cli"
```

---

### Task 8: Migrate migrate command

**Files:**
- Create: `apps/refarm/src/commands/migrate.ts`
- Create: `apps/refarm/test/commands/migrate.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/migrate.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/migrate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMirrorRepo, mockSiloResolve, mockInquirerPrompt } = vi.hoisted(() => ({
  mockMirrorRepo: vi.fn().mockResolvedValue({ status: "dry-run" }),
  mockSiloResolve: vi.fn().mockResolvedValue(new Map([
    ["REFARM_GITHUB_TOKEN", "ghp_test"],
  ])),
  mockInquirerPrompt: vi.fn().mockResolvedValue({ targetUrl: "https://github.com/user/fork.git" }),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { resolve: mockSiloResolve };
  }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () {
    return { github: { mirrorRepo: mockMirrorRepo } };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
    ),
    default: {
      ...actual.default,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({ brand: { slug: "my-farm", urls: { repository: "https://github.com/user/repo.git" } }, infrastructure: { gitHost: "github" } })
      ),
    },
  };
});

import { migrateCommand } from "../../src/commands/migrate.js";

describe("migrateCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mirrorRepo with provided --target URL", async () => {
    await migrateCommand.parseAsync(["--target", "https://github.com/user/fork.git", "--dry-run"], { from: "user" });
    expect(mockMirrorRepo).toHaveBeenCalledWith(
      expect.any(String),
      "https://github.com/user/fork.git",
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("does not throw on dry-run success", async () => {
    await expect(
      migrateCommand.parseAsync(["--target", "https://github.com/user/fork.git", "--dry-run"], { from: "user" })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/migrate.js'`

- [ ] **Step 3: Copy migrate.ts to apps/refarm**

Copy `packages/cli/src/commands/migrate.ts` verbatim to `apps/refarm/src/commands/migrate.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { migrateCommand } from "./commands/migrate.js";
program.addCommand(migrateCommand);
```

- [ ] **Step 6: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/migrate.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/migrate.ts apps/refarm/test/commands/migrate.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate migrate command from packages/cli"
```

---

### Task 9: Migrate deploy command

**Files:**
- Create: `apps/refarm/src/commands/deploy.ts`
- Create: `apps/refarm/test/commands/deploy.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/deploy.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/deploy.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeploy, mockProvision } = vi.hoisted(() => ({
  mockDeploy: vi.fn().mockResolvedValue({ status: "dry-run" }),
  mockProvision: vi.fn().mockReturnValue({}),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { provision: mockProvision };
  }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () {
    return { deploy: mockDeploy };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    default: {
      ...actual.default,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify({ brand: { slug: "my-farm" } })),
    },
  };
});

import { deployCommand } from "../../src/commands/deploy.js";

describe("deployCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls windmill.deploy with the given target", async () => {
    await deployCommand.parseAsync(["--target", "github", "--dry-run"], { from: "user" });
    expect(mockDeploy).toHaveBeenCalledWith("github");
  });

  it("does not throw on dry-run success", async () => {
    await expect(
      deployCommand.parseAsync(["--dry-run"], { from: "user" })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/deploy.js'`

- [ ] **Step 3: Copy deploy.ts to apps/refarm**

Copy `packages/cli/src/commands/deploy.ts` verbatim to `apps/refarm/src/commands/deploy.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { deployCommand } from "./commands/deploy.js";
program.addCommand(deployCommand);
```

- [ ] **Step 6: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/deploy.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/deploy.ts apps/refarm/test/commands/deploy.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate deploy command from packages/cli"
```

---

### Task 10: Migrate plugin command

**Files:**
- Create: `apps/refarm/src/commands/plugin.ts`
- Create: `apps/refarm/test/commands/plugin.test.ts`
- Modify: `apps/refarm/src/program.ts`
- Delete: `packages/cli/src/commands/plugin.ts`
- Delete: `packages/cli/src/commands/plugin.test.ts`

- [ ] **Step 1: Copy plugin.ts to apps/refarm**

Copy `packages/cli/src/commands/plugin.ts` verbatim to `apps/refarm/src/commands/plugin.ts`.

- [ ] **Step 2: Move plugin.test.ts to apps/refarm**

Copy `packages/cli/src/commands/plugin.test.ts` to `apps/refarm/test/commands/plugin.test.ts`.

Update the import at the bottom of the test:

```typescript
// Change:
import { pluginCommand } from "./plugin.js";
// To:
import { pluginCommand } from "../../src/commands/plugin.js";
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass (plugin tests have ~10 cases).

- [ ] **Step 4: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { pluginCommand } from "./commands/plugin.js";
program.addCommand(pluginCommand);
```

- [ ] **Step 5: Delete from packages/cli**

```bash
git rm packages/cli/src/commands/plugin.ts packages/cli/src/commands/plugin.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/refarm/src/commands/plugin.ts apps/refarm/test/commands/plugin.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): migrate plugin command from packages/cli"
```

---

### Task 11: Add status command

**Files:**
- Create: `apps/refarm/src/commands/status.ts`
- Create: `apps/refarm/test/commands/status.test.ts`
- Modify: `apps/refarm/src/program.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/test/commands/status.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBoot, mockShutdown } = vi.hoisted(() => ({
  mockBoot: vi.fn(),
  mockShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@refarm.dev/tractor", () => ({
  Tractor: {
    boot: mockBoot,
  },
}));

vi.mock("@refarm.dev/cli/status", () => ({
  buildRefarmStatusJson: vi.fn().mockReturnValue({
    schemaVersion: 1,
    host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
    renderer: { id: "refarm-headless", kind: "headless", capabilities: ["surfaces", "telemetry", "diagnostics"] },
    runtime: { ready: true, databaseName: "refarm-main", namespace: "refarm-main" },
    plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
    trust: { profile: "strict", warnings: 0, critical: 0 },
    streams: { active: 0, terminal: 0 },
    diagnostics: [],
  }),
}));

import { statusCommand } from "../../src/commands/status.js";

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoot.mockResolvedValue({
      namespace: "refarm-main",
      defaultSecurityMode: "strict",
      shutdown: mockShutdown,
    });
  });

  it("boots Tractor with logLevel silent", async () => {
    await statusCommand.parseAsync(["--json"], { from: "user" });
    expect(mockBoot).toHaveBeenCalledWith(
      expect.objectContaining({ logLevel: "silent" }),
    );
  });

  it("calls tractor.shutdown after producing output", async () => {
    await statusCommand.parseAsync(["--json"], { from: "user" });
    expect(mockShutdown).toHaveBeenCalled();
  });

  it("outputs valid JSON with schemaVersion:1 when --json is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand.parseAsync(["--json"], { from: "user" });
    const output = spy.mock.calls.find(([line]) =>
      typeof line === "string" && line.includes("schemaVersion")
    );
    expect(output).toBeDefined();
    const parsed = JSON.parse(output![0] as string);
    expect(parsed.schemaVersion).toBe(1);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/commands/status.js'`

- [ ] **Step 3: Implement status.ts**

```typescript
// apps/refarm/src/commands/status.ts
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { Tractor } from "@refarm.dev/tractor";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { buildRefarmStatusJson, type RefarmStatusJson } from "@refarm.dev/cli/status";
import { createRuntimeSummaryFromTractor } from "@refarm.dev/runtime";
import { createTrustSummaryFromTractor } from "@refarm.dev/trust";
import { REFARM_HEADLESS_RENDERER } from "../renderers.js";

function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async ensureSchema() {},
    async storeNode(id, type, context, payload, sourcePlugin) {
      store.set(id, { id, type, context, payload, sourcePlugin });
    },
    async queryNodes(type: string) {
      return Array.from(store.values()).filter((r) => (r as { type: string }).type === type);
    },
    async execute(_sql: string, _args?: unknown) { return []; },
    async query<T>(_sql: string, _args?: unknown): Promise<T[]> { return []; },
    async transaction<T>(fn: () => Promise<T>) { return fn(); },
    async close() {},
  };
}

function createEphemeralIdentity(): IdentityAdapter {
  return { publicKey: undefined };
}

function readNamespaceFromConfig(): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "refarm.config.json"), "utf-8");
    return (JSON.parse(raw) as { brand?: { slug?: string } }).brand?.slug;
  } catch {
    return undefined;
  }
}

function printStatusSummary(json: RefarmStatusJson): void {
  console.log(`Host:      ${json.host.app} (${json.host.mode})`);
  console.log(`Renderer:  ${json.renderer.id} (${json.renderer.kind})`);
  console.log(`Runtime:   ${json.runtime.ready ? "ready" : "not ready"} — ${json.runtime.namespace}`);
  console.log(`Trust:     ${json.trust.profile} — warnings: ${json.trust.warnings}, critical: ${json.trust.critical}`);
  console.log(`Plugins:   ${json.plugins.installed} installed, ${json.plugins.active} active`);
  console.log(`Streams:   ${json.streams.active} active, ${json.streams.terminal} terminal`);
  if (json.diagnostics.length > 0) {
    console.log("Diagnostics:");
    for (const d of json.diagnostics) console.log(`  - ${d}`);
  }
}

export const statusCommand = new Command("status")
  .description("Report host status")
  .option("--json", "Output machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const tractor = await Tractor.boot({
      namespace: readNamespaceFromConfig() ?? "refarm-main",
      storage: createMemoryStorage(),
      identity: createEphemeralIdentity(),
      logLevel: "silent",
    });

    const runtime = createRuntimeSummaryFromTractor(tractor);
    const trust = createTrustSummaryFromTractor(tractor);

    const json = buildRefarmStatusJson({
      host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test --workspace=apps/refarm 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Wire into program.ts**

```typescript
// apps/refarm/src/program.ts — add:
import { statusCommand } from "./commands/status.js";
program.addCommand(statusCommand);
```

- [ ] **Step 6: Commit**

```bash
git add apps/refarm/src/commands/status.ts apps/refarm/test/commands/status.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): add status command with headless Tractor probe"
```

---

### Task 12: Strip packages/cli to library-only

**Files:**
- Modify: `packages/cli/package.json` — remove bin, commander, inquirer, chalk, command deps
- Modify: `packages/cli/src/index.ts` — strip to type re-exports only
- Delete: `packages/cli/src/program.ts`
- Delete: `packages/cli/src/index.ts` (replaced)

At this point `packages/cli/src/commands/` should be empty — all files were deleted in Tasks 4–10. Verify:

- [ ] **Step 1: Confirm commands/ is empty**

```bash
ls packages/cli/src/commands/ 2>&1
```

Expected: no files (or directory not found — both are fine).

- [ ] **Step 2: Delete program.ts and commands directory**

```bash
git rm packages/cli/src/program.ts
git rm -r packages/cli/src/commands/ 2>/dev/null || true
```

- [ ] **Step 3: Replace index.ts with library-only re-exports**

```typescript
// packages/cli/src/index.ts
export type { RefarmStatusJson, RefarmStatusOptions } from "./status.js";
export { buildRefarmStatusJson } from "./status.js";
```

- [ ] **Step 4: Update packages/cli/package.json**

Remove `bin`, `commander`, `inquirer`, `chalk` and all command-specific dependencies. Keep only library-relevant deps:

```json
{
  "name": "@refarm.dev/cli",
  "version": "0.1.0",
  "description": "Refarm CLI library — status builder and shared types.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./status": {
      "types": "./dist/status.d.ts",
      "import": "./dist/status.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@refarm.dev/homestead": "*",
    "@refarm.dev/trust": "*",
    "@refarm.dev/runtime": "*"
  },
  "license": "AGPL-3.0-only",
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 5: Run packages/cli tests to verify they still pass**

```bash
npm test --workspace=packages/cli 2>&1 | tail -10
```

Expected: `Tests  31 passed (31)`

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/package.json
git commit -m "refactor(cli): strip packages/cli to library-only — remove bin and all command files"
```

---

### Task 13: Smoke gate

- [ ] **Step 1: Run all affected workspaces**

```bash
npm test --workspace=packages/trust --workspace=packages/runtime --workspace=packages/cli --workspace=apps/refarm 2>&1 | tail -30
```

Expected output (counts may vary as tests are added):
```
Tests  4 passed   (packages/trust)
Tests  3 passed   (packages/runtime)
Tests  31 passed  (packages/cli)
Tests  XX passed  (apps/refarm)
```

All test files must show `passed` with zero failures.

- [ ] **Step 2: Type-check apps/refarm**

```bash
npm run type-check --workspace=apps/refarm 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Type-check packages/cli**

```bash
npm run type-check --workspace=packages/cli 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit smoke gate result**

```bash
git commit --allow-empty -m "chore(refarm): smoke gate passed — apps/refarm scaffold complete"
```
