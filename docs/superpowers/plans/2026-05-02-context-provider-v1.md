# Context Provider v1 + `refarm ask` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `context-provider-v1` capability contract and `refarm ask` CLI command that auto-injects project context (cwd, date, git status, files) and streams pi-agent's response token-by-token to the terminal.

**Architecture:** A standalone `packages/context-provider-v1/` package defines `ContextProvider`, `ContextRegistry` (parallel `Promise.allSettled` collection), and `buildSystemPrompt()` (priority-sorted XML-style context wrapping). The `refarm ask` command assembles context, POSTs an effort to Farmhand HTTP at port 42001, then tails the NDJSON stream file at `~/.refarm/streams/<effortId>.ndjson` (written by `FileStreamTransport` in Farmhand) to print tokens as they arrive and a usage footer on `is_final`.

**Tech Stack:** TypeScript, Node.js built-ins (`fs`, `child_process`), `chalk`, `commander` (already in `apps/refarm`), Vitest.

**Prerequisite:** Slice 7.1 (stream-contract-v1) must be implemented first — specifically `packages/file-stream-transport/` must exist and Farmhand must write `StreamChunk` nodes to `~/.refarm/streams/`. Tasks 1–3 of this plan can be built without it; Tasks 4 and 5 require it.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/context-provider-v1/package.json` | Package manifest |
| Create | `packages/context-provider-v1/tsconfig.json` | TS dev config |
| Create | `packages/context-provider-v1/tsconfig.build.json` | TS build config |
| Create | `packages/context-provider-v1/src/types.ts` | `ContextProvider`, `ContextRequest`, `ContextEntry`, `CONTEXT_CAPABILITY` |
| Create | `packages/context-provider-v1/src/registry.ts` | `ContextRegistry` + `buildSystemPrompt` |
| Create | `packages/context-provider-v1/src/providers/cwd.ts` | `CwdContextProvider` |
| Create | `packages/context-provider-v1/src/providers/date.ts` | `DateContextProvider` |
| Create | `packages/context-provider-v1/src/providers/git-status.ts` | `GitStatusContextProvider` |
| Create | `packages/context-provider-v1/src/providers/files.ts` | `FilesContextProvider` |
| Create | `packages/context-provider-v1/src/index.ts` | Re-exports all public API |
| Create | `packages/context-provider-v1/src/registry.test.ts` | Unit tests for `ContextRegistry` + `buildSystemPrompt` |
| Create | `packages/context-provider-v1/src/providers/providers.test.ts` | Unit tests for all four bundled providers |
| Create | `apps/refarm/src/commands/ask.ts` | `refarm ask` command (factory + default export) |
| Create | `apps/refarm/test/commands/ask.test.ts` | Unit tests for ask command |
| Modify | `apps/refarm/src/program.ts` | Register `askCommand` |
| Modify | `apps/refarm/package.json` | Add `@refarm.dev/context-provider-v1` and `@refarm.dev/file-stream-transport` deps |
| Modify | `specs/features/context-provider-v1.md` | Mark SDD tasks done, TDD/DDD checkboxes |

---

## Task 1: `context-provider-v1` package — types, registry, buildSystemPrompt

**Files:**
- Create: `packages/context-provider-v1/package.json`
- Create: `packages/context-provider-v1/tsconfig.json`
- Create: `packages/context-provider-v1/tsconfig.build.json`
- Create: `packages/context-provider-v1/src/types.ts`
- Create: `packages/context-provider-v1/src/registry.ts`
- Create: `packages/context-provider-v1/src/index.ts`
- Create: `packages/context-provider-v1/src/registry.test.ts`

- [ ] **Step 1: Create `packages/context-provider-v1/package.json`**

```json
{
  "name": "@refarm.dev/context-provider-v1",
  "version": "0.1.0",
  "description": "Versioned context capability contract (context:v1) — composable context providers for AI system prompts",
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
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["plugin", "capability", "context", "contract", "ai", "system-prompt"],
  "author": "Refarm Contributors",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/context-provider-v1"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@types/node": "^25.6.0",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/context-provider-v1/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/context-provider-v1/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "emitDeclarationOnly": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write failing tests — `packages/context-provider-v1/src/registry.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ContextRegistry, buildSystemPrompt } from "./registry.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "./types.js";
import { CONTEXT_CAPABILITY } from "./types.js";

function makeProvider(
  name: string,
  entries: ContextEntry[],
  priority = 100,
): ContextProvider {
  return {
    name,
    capability: CONTEXT_CAPABILITY,
    provide: vi.fn().mockResolvedValue(
      entries.map((e) => ({ ...e, priority: e.priority ?? priority })),
    ),
  };
}

function makeThrowingProvider(name: string): ContextProvider {
  return {
    name,
    capability: CONTEXT_CAPABILITY,
    provide: vi.fn().mockRejectedValue(new Error("provider exploded")),
  };
}

describe("ContextRegistry", () => {
  it("collects entries from all providers", async () => {
    const p1 = makeProvider("a", [{ label: "a", content: "alpha" }]);
    const p2 = makeProvider("b", [{ label: "b", content: "beta" }]);
    const registry = new ContextRegistry([p1, p2]);
    const entries = await registry.collect({ cwd: "/project" });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.label)).toContain("a");
    expect(entries.map((e) => e.label)).toContain("b");
  });

  it("calls all providers with the request object", async () => {
    const p = makeProvider("c", []);
    const registry = new ContextRegistry([p]);
    const req: ContextRequest = { cwd: "/workspace", query: "what is X?" };
    await registry.collect(req);
    expect(p.provide).toHaveBeenCalledWith(req);
  });

  it("isolates a throwing provider — others still contribute", async () => {
    const good = makeProvider("good", [{ label: "ok", content: "data" }]);
    const bad = makeThrowingProvider("bad");
    const registry = new ContextRegistry([good, bad]);
    const entries = await registry.collect({ cwd: "/" });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("ok");
  });

  it("returns empty array when all providers throw", async () => {
    const registry = new ContextRegistry([
      makeThrowingProvider("x"),
      makeThrowingProvider("y"),
    ]);
    const entries = await registry.collect({ cwd: "/" });
    expect(entries).toEqual([]);
  });

  it("collects providers in parallel (Promise.allSettled)", async () => {
    const order: string[] = [];
    const fast: ContextProvider = {
      name: "fast",
      capability: CONTEXT_CAPABILITY,
      provide: async () => {
        order.push("fast");
        return [{ label: "fast", content: "x" }];
      },
    };
    const slow: ContextProvider = {
      name: "slow",
      capability: CONTEXT_CAPABILITY,
      provide: async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("slow");
        return [{ label: "slow", content: "y" }];
      },
    };
    const registry = new ContextRegistry([slow, fast]);
    const entries = await registry.collect({ cwd: "/" });
    expect(entries).toHaveLength(2);
    expect(order).toEqual(["fast", "slow"]);
  });
});

describe("buildSystemPrompt", () => {
  it("wraps entries with preamble and contexts tag", () => {
    const entries: ContextEntry[] = [
      { label: "cwd", content: "/workspace", priority: 10 },
    ];
    const prompt = buildSystemPrompt(entries);
    expect(prompt).toContain("You are pi-agent");
    expect(prompt).toContain("<contexts>");
    expect(prompt).toContain("</contexts>");
    expect(prompt).toContain('<context label="cwd">');
    expect(prompt).toContain("/workspace");
  });

  it("sorts entries by priority — lower priority value appears first", () => {
    const entries: ContextEntry[] = [
      { label: "last", content: "Z", priority: 90 },
      { label: "first", content: "A", priority: 5 },
      { label: "mid", content: "M", priority: 50 },
    ];
    const prompt = buildSystemPrompt(entries);
    const firstIdx = prompt.indexOf('"first"');
    const midIdx = prompt.indexOf('"mid"');
    const lastIdx = prompt.indexOf('"last"');
    expect(firstIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lastIdx);
  });

  it("defaults missing priority to 100", () => {
    const entries: ContextEntry[] = [
      { label: "explicit", content: "X", priority: 50 },
      { label: "default", content: "Y" },
    ];
    const prompt = buildSystemPrompt(entries);
    const explicitIdx = prompt.indexOf('"explicit"');
    const defaultIdx = prompt.indexOf('"default"');
    expect(explicitIdx).toBeLessThan(defaultIdx);
  });

  it("returns preamble even for empty entries list", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("You are pi-agent");
    expect(prompt).toContain("<contexts>");
    expect(prompt).toContain("</contexts>");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
cd packages/context-provider-v1 && npx vitest run
```

Expected: FAIL — `registry.ts` and `types.ts` do not exist yet.

- [ ] **Step 6: Create `packages/context-provider-v1/src/types.ts`**

```typescript
export const CONTEXT_CAPABILITY = "context:v1" as const;

export interface ContextRequest {
  cwd: string;
  query?: string;
}

export interface ContextEntry {
  label: string;
  content: string;
  priority?: number;
}

export interface ContextProvider {
  readonly name: string;
  readonly capability: typeof CONTEXT_CAPABILITY;
  provide(request: ContextRequest): Promise<ContextEntry[]>;
}
```

- [ ] **Step 7: Create `packages/context-provider-v1/src/registry.ts`**

```typescript
import type { ContextEntry, ContextProvider, ContextRequest } from "./types.js";

export class ContextRegistry {
  constructor(private readonly providers: ContextProvider[]) {}

  async collect(request: ContextRequest): Promise<ContextEntry[]> {
    const results = await Promise.allSettled(
      this.providers.map((p) => p.provide(request)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<ContextEntry[]> =>
          r.status === "fulfilled",
      )
      .flatMap((r) => r.value);
  }
}

export function buildSystemPrompt(entries: ContextEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
  );
  const contextBlocks = sorted
    .map((e) => `<context label="${e.label}">\n${e.content}\n</context>`)
    .join("\n");
  return [
    "You are pi-agent, a sovereign AI assistant for a Refarm node.",
    "The following project context has been collected automatically:",
    "<contexts>",
    contextBlocks,
    "</contexts>",
    "Answer the user's question using this context.",
  ].join("\n");
}
```

- [ ] **Step 8: Create `packages/context-provider-v1/src/index.ts`**

```typescript
export { CONTEXT_CAPABILITY } from "./types.js";
export type {
  ContextEntry,
  ContextProvider,
  ContextRequest,
} from "./types.js";
export { ContextRegistry, buildSystemPrompt } from "./registry.js";
export { CwdContextProvider } from "./providers/cwd.js";
export { DateContextProvider } from "./providers/date.js";
export { GitStatusContextProvider } from "./providers/git-status.js";
export { FilesContextProvider } from "./providers/files.js";
```

Note: `index.ts` references providers that don't exist yet. TypeScript will error until Task 2 adds them. That is expected at this stage — just make sure the test runner (`vitest`) can resolve `./registry.js` and `./types.js` for the registry tests.

- [ ] **Step 9: Run registry tests**

```bash
cd packages/context-provider-v1 && npx vitest run --reporter=verbose src/registry.test.ts
```

Expected: 9 tests pass. Ignore TS errors about missing provider files for now.

- [ ] **Step 10: Commit**

```bash
git add packages/context-provider-v1/
git commit -m "feat(context): scaffold context-provider-v1 — types, ContextRegistry, buildSystemPrompt"
```

---

## Task 2: Bundled context providers

**Files:**
- Create: `packages/context-provider-v1/src/providers/cwd.ts`
- Create: `packages/context-provider-v1/src/providers/date.ts`
- Create: `packages/context-provider-v1/src/providers/git-status.ts`
- Create: `packages/context-provider-v1/src/providers/files.ts`
- Create: `packages/context-provider-v1/src/providers/providers.test.ts`

- [ ] **Step 1: Write failing tests — `packages/context-provider-v1/src/providers/providers.test.ts`**

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CwdContextProvider } from "./cwd.js";
import { DateContextProvider } from "./date.js";
import { GitStatusContextProvider } from "./git-status.js";
import { FilesContextProvider } from "./files.js";
import { CONTEXT_CAPABILITY } from "../types.js";

describe("CwdContextProvider", () => {
  it("has correct name and capability", () => {
    const p = new CwdContextProvider();
    expect(p.name).toBe("cwd");
    expect(p.capability).toBe(CONTEXT_CAPABILITY);
  });

  it("returns one entry with label cwd and the cwd as content", async () => {
    const p = new CwdContextProvider();
    const entries = await p.provide({ cwd: "/workspace/refarm" });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("cwd");
    expect(entries[0].content).toBe("/workspace/refarm");
    expect(entries[0].priority).toBe(10);
  });
});

describe("DateContextProvider", () => {
  it("has correct name and capability", () => {
    const p = new DateContextProvider();
    expect(p.name).toBe("date");
    expect(p.capability).toBe(CONTEXT_CAPABILITY);
  });

  it("returns one entry with ISO date and day of week", async () => {
    const p = new DateContextProvider();
    const entries = await p.provide({ cwd: "/" });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("date");
    expect(entries[0].content).toMatch(/^\d{4}-\d{2}-\d{2},\s+\w+$/);
    expect(entries[0].priority).toBe(20);
  });
});

describe("GitStatusContextProvider", () => {
  it("has correct name and capability", () => {
    const p = new GitStatusContextProvider();
    expect(p.name).toBe("git_status");
    expect(p.capability).toBe(CONTEXT_CAPABILITY);
  });

  it("returns one entry when run inside this repo", async () => {
    const p = new GitStatusContextProvider();
    const entries = await p.provide({ cwd: process.cwd() });
    expect(entries.length).toBeGreaterThanOrEqual(0);
    if (entries.length > 0) {
      expect(entries[0].label).toBe("git_status");
      expect(entries[0].priority).toBe(30);
      expect(typeof entries[0].content).toBe("string");
    }
  });

  it("returns empty array when cwd is not a git repo", async () => {
    const p = new GitStatusContextProvider();
    const entries = await p.provide({ cwd: os.tmpdir() });
    expect(entries).toEqual([]);
  });
});

describe("FilesContextProvider", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ctx-files-test-"));
    writeFileSync(path.join(tmpDir, "small.txt"), "hello world");
    writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(5 * 1024));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has correct name and capability", () => {
    const p = new FilesContextProvider(["small.txt"]);
    expect(p.name).toBe("files");
    expect(p.capability).toBe(CONTEXT_CAPABILITY);
  });

  it("returns empty array when no files are given", async () => {
    const p = new FilesContextProvider([]);
    expect(await p.provide({ cwd: tmpDir })).toEqual([]);
  });

  it("reads file relative to cwd and returns entry with file label", async () => {
    const p = new FilesContextProvider(["small.txt"]);
    const entries = await p.provide({ cwd: tmpDir });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("file:small.txt");
    expect(entries[0].content).toContain("hello world");
    expect(entries[0].priority).toBe(50);
  });

  it("truncates files larger than 4 KB and appends truncation notice", async () => {
    const p = new FilesContextProvider(["big.txt"]);
    const entries = await p.provide({ cwd: tmpDir });
    expect(entries).toHaveLength(1);
    expect(entries[0].content.length).toBeLessThanOrEqual(4 * 1024 + 60);
    expect(entries[0].content).toContain("[truncated at 4 KB]");
  });

  it("skips unreadable files silently — other files still appear", async () => {
    const p = new FilesContextProvider(["small.txt", "missing.txt"]);
    const entries = await p.provide({ cwd: tmpDir });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("file:small.txt");
  });

  it("resolves absolute paths directly, ignoring cwd", async () => {
    const absPath = path.join(tmpDir, "small.txt");
    const p = new FilesContextProvider([absPath]);
    const entries = await p.provide({ cwd: "/some/other/dir" });
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain("hello world");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/context-provider-v1 && npx vitest run src/providers/providers.test.ts
```

Expected: FAIL — provider files do not exist yet.

- [ ] **Step 3: Create `packages/context-provider-v1/src/providers/cwd.ts`**

```typescript
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

export class CwdContextProvider implements ContextProvider {
  readonly name = "cwd";
  readonly capability = CONTEXT_CAPABILITY;

  async provide(request: ContextRequest): Promise<ContextEntry[]> {
    return [{ label: "cwd", content: request.cwd, priority: 10 }];
  }
}
```

- [ ] **Step 4: Create `packages/context-provider-v1/src/providers/date.ts`**

```typescript
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

export class DateContextProvider implements ContextProvider {
  readonly name = "date";
  readonly capability = CONTEXT_CAPABILITY;

  async provide(_request: ContextRequest): Promise<ContextEntry[]> {
    const now = new Date();
    const day = now.toLocaleDateString("en-US", { weekday: "long" });
    const iso = now.toISOString().slice(0, 10);
    return [{ label: "date", content: `${iso}, ${day}`, priority: 20 }];
  }
}
```

- [ ] **Step 5: Create `packages/context-provider-v1/src/providers/git-status.ts`**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitStatusContextProvider implements ContextProvider {
  readonly name = "git_status";
  readonly capability = CONTEXT_CAPABILITY;

  async provide(request: ContextRequest): Promise<ContextEntry[]> {
    try {
      const [statusResult, logResult] = await Promise.all([
        execFileAsync("git", ["status", "--short"], { cwd: request.cwd }),
        execFileAsync("git", ["log", "--oneline", "-5"], { cwd: request.cwd }),
      ]);
      const content = [
        statusResult.stdout.trim() || "(no changes)",
        "",
        "Last 5 commits:",
        logResult.stdout.trim() || "(no commits)",
      ].join("\n");
      return [{ label: "git_status", content, priority: 30 }];
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 6: Create `packages/context-provider-v1/src/providers/files.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

const MAX_FILE_BYTES = 4 * 1024;

export class FilesContextProvider implements ContextProvider {
  readonly name = "files";
  readonly capability = CONTEXT_CAPABILITY;

  constructor(private readonly files: string[]) {}

  async provide(request: ContextRequest): Promise<ContextEntry[]> {
    if (this.files.length === 0) return [];
    const entries: ContextEntry[] = [];
    for (const file of this.files) {
      const filePath = path.isAbsolute(file)
        ? file
        : path.join(request.cwd, file);
      try {
        const buf = fs.readFileSync(filePath);
        const content =
          buf.length > MAX_FILE_BYTES
            ? buf.slice(0, MAX_FILE_BYTES).toString("utf-8") +
              "\n[truncated at 4 KB]"
            : buf.toString("utf-8");
        entries.push({ label: `file:${file}`, content, priority: 50 });
      } catch {
        // unreadable file — skip silently
      }
    }
    return entries;
  }
}
```

- [ ] **Step 7: Run provider tests**

```bash
cd packages/context-provider-v1 && npx vitest run
```

Expected: all tests pass (registry tests + provider tests).

- [ ] **Step 8: Commit**

```bash
git add packages/context-provider-v1/src/providers/
git commit -m "feat(context): add bundled providers — cwd, date, git-status, files"
```

---

## Task 3: `refarm ask` command

**Files:**
- Create: `apps/refarm/src/commands/ask.ts`
- Create: `apps/refarm/test/commands/ask.test.ts`

**Context:** The `ask` command submits an effort to Farmhand HTTP (`http://127.0.0.1:42001/efforts`) then tails the NDJSON stream file at `~/.refarm/streams/<effortId>.ndjson` — the file written by `FileStreamTransport` in Farmhand. Polling at 100ms intervals, it reads new lines from the file and delivers them to the caller until `is_final: true`. This works across process boundaries and achieves the replay semantics in AC#5: if the effort finishes before the command subscribes, all chunks are replayed from offset 0.

The command uses a factory function `createAskCommand(deps?)` — identical pattern to `createTaskCommand()` in `task.ts` — so that tests can inject mock adapters.

- [ ] **Step 1: Write failing tests — `apps/refarm/test/commands/ask.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAskCommand } from "../../src/commands/ask.js";
import type { AskDeps } from "../../src/commands/ask.js";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

function makeChunk(
  content: string,
  sequence: number,
  is_final: boolean,
  metadata?: unknown,
): StreamChunk {
  return { stream_ref: "eff-1", content, sequence, is_final, metadata };
}

function makeDeps(overrides: Partial<AskDeps> = {}): AskDeps {
  return {
    submitEffort: vi.fn().mockResolvedValue("eff-1"),
    followStream: vi
      .fn()
      .mockImplementation(
        async (
          _effortId: string,
          onChunk: (c: StreamChunk) => void,
        ): Promise<void> => {
          onChunk(makeChunk("hello ", 0, false));
          onChunk(
            makeChunk("world", 1, true, {
              model: "claude-sonnet-4-6",
              tokens_in: 50,
              tokens_out: 100,
              estimated_usd: 0.0005,
            }),
          );
        },
      ),
    ...overrides,
  };
}

describe("refarm ask", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("submits an effort with correct pluginId, fn, and args", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["what is CRDT?"], { from: "user" });

    expect(deps.submitEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "ask",
        source: "refarm-ask",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            pluginId: "pi-agent",
            fn: "respond",
            args: expect.objectContaining({ prompt: "what is CRDT?" }),
          }),
        ]),
      }),
    );
  });

  it("includes system prompt with context in the submitted args", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["explain this"], { from: "user" });

    const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const args = effort.tasks[0].args as Record<string, unknown>;
    expect(typeof args.system).toBe("string");
    expect(args.system as string).toContain("You are pi-agent");
  });

  it("follows stream with the returned effortId", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["test query"], { from: "user" });

    expect(deps.followStream).toHaveBeenCalledWith(
      "eff-1",
      expect.any(Function),
    );
  });

  it("prints chunk content to stdout as tokens arrive", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["hi"], { from: "user" });

    const written = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(written).toContain("hello ");
    expect(written).toContain("world");
  });

  it("prints usage footer when is_final is true", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["hi"], { from: "user" });

    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("claude-sonnet-4-6");
    expect(logged).toContain("50");
    expect(logged).toContain("100");
    expect(logged).toContain("0.0005");
  });

  it("prints no footer when is_final chunk has no metadata", async () => {
    const deps = makeDeps({
      followStream: vi
        .fn()
        .mockImplementation(async (_id: string, onChunk: (c: StreamChunk) => void) => {
          onChunk(makeChunk("done", 0, true));
        }),
    });
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["hi"], { from: "user" });
    const logged = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(logged).not.toContain("tokens:");
  });

  it("passes --files to FilesContextProvider via system prompt", async () => {
    const deps = makeDeps();
    const cmd = createAskCommand(deps);
    await cmd.parseAsync(["query", "--files", "README.md,package.json"], {
      from: "user",
    });
    const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const system = effort.tasks[0].args.system as string;
    expect(system).toContain("You are pi-agent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/refarm && npx vitest run test/commands/ask.test.ts
```

Expected: FAIL — `ask.ts` does not exist yet.

- [ ] **Step 3: Create `apps/refarm/src/commands/ask.ts`**

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import {
  buildSystemPrompt,
  ContextRegistry,
  CwdContextProvider,
  DateContextProvider,
  FilesContextProvider,
  GitStatusContextProvider,
} from "@refarm.dev/context-provider-v1";

export interface AskDeps {
  submitEffort(effort: Effort): Promise<string>;
  followStream(
    effortId: string,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void>;
}

async function submitViaHttp(effort: Effort): Promise<string> {
  const response = await fetch("http://127.0.0.1:42001/efforts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(effort),
  });
  if (!response.ok) throw new Error(`Farmhand HTTP ${response.status}`);
  const payload = (await response.json()) as { effortId: string };
  return payload.effortId;
}

function followStreamFile(
  streamsDir: string,
  effortId: string,
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const filePath = path.join(streamsDir, `${effortId}.ndjson`);
    let offset = 0;

    function readNew(): void {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (let i = offset; i < lines.length; i++) {
        const chunk = JSON.parse(lines[i]) as StreamChunk;
        onChunk(chunk);
        if (chunk.is_final) {
          clearInterval(timer);
          resolve();
          return;
        }
      }
      offset = lines.length;
    }

    const timer = setInterval(readNew, 100);
    readNew();
  });
}

function defaultDeps(): AskDeps {
  const streamsDir = path.join(os.homedir(), ".refarm", "streams");
  return {
    submitEffort: submitViaHttp,
    followStream: (effortId, onChunk) =>
      followStreamFile(streamsDir, effortId, onChunk),
  };
}

export function createAskCommand(deps?: AskDeps): Command {
  const resolved = deps ?? defaultDeps();

  return new Command("ask")
    .description("Ask pi-agent a question with automatic project context")
    .argument("<query>", "The question or instruction for pi-agent")
    .option("--files <files>", "Comma-separated file paths to include in context")
    .action(async (query: string, opts: { files?: string }) => {
      const files = opts.files
        ? opts.files.split(",").map((f) => f.trim()).filter(Boolean)
        : [];

      const providers = [
        new CwdContextProvider(),
        new DateContextProvider(),
        new GitStatusContextProvider(),
        ...(files.length > 0 ? [new FilesContextProvider(files)] : []),
      ];

      const registry = new ContextRegistry(providers);
      const entries = await registry.collect({
        cwd: process.cwd(),
        query,
      });
      const system = buildSystemPrompt(entries);

      const effort: Effort = {
        id: crypto.randomUUID(),
        direction: "ask",
        tasks: [
          {
            id: crypto.randomUUID(),
            pluginId: "pi-agent",
            fn: "respond",
            args: { prompt: query, system },
          },
        ],
        source: "refarm-ask",
        submittedAt: new Date().toISOString(),
      };

      console.log(chalk.bold.cyan(`pi-agent ▸ ${query}\n`));

      const effortId = await resolved.submitEffort(effort);

      await resolved.followStream(effortId, (chunk: StreamChunk) => {
        process.stdout.write(chunk.content);
        if (chunk.is_final) {
          process.stdout.write("\n");
          const meta = chunk.metadata as Record<string, unknown> | undefined;
          if (meta) {
            const model = meta.model ?? "unknown";
            const tokensIn = meta.tokens_in ?? 0;
            const tokensOut = meta.tokens_out ?? 0;
            const usd =
              meta.estimated_usd != null
                ? `~$${Number(meta.estimated_usd).toFixed(4)}`
                : "";
            console.log(chalk.gray(`\n${"─".repeat(41)}`));
            console.log(
              chalk.gray(
                `model: ${model}  tokens: ${tokensIn} in / ${tokensOut} out  ${usd}`,
              ),
            );
          }
        }
      });
    });
}

export const askCommand = createAskCommand();
```

- [ ] **Step 4: Run tests**

```bash
cd apps/refarm && npx vitest run test/commands/ask.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/refarm/src/commands/ask.ts apps/refarm/test/commands/ask.test.ts
git commit -m "feat(ask): add refarm ask command — context assembly + effort submit + stream tail"
```

---

## Task 4: Wire `ask` into `program.ts` and add package dependencies

**Files:**
- Modify: `apps/refarm/src/program.ts`
- Modify: `apps/refarm/package.json`
- Modify: `specs/features/context-provider-v1.md`

- [ ] **Step 1: Add `@refarm.dev/context-provider-v1` and `@refarm.dev/file-stream-transport` to `apps/refarm/package.json`**

Open `apps/refarm/package.json`. In the `"dependencies"` object, add these two entries:

```json
"@refarm.dev/context-provider-v1": "*",
"@refarm.dev/file-stream-transport": "*",
```

The full `dependencies` block becomes:

```json
"dependencies": {
  "@refarm.dev/cli": "*",
  "@refarm.dev/config": "*",
  "@refarm.dev/context-provider-v1": "*",
  "@refarm.dev/effort-contract-v1": "*",
  "@refarm.dev/file-stream-transport": "*",
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
```

- [ ] **Step 2: Register `@refarm.dev/stream-contract-v1` path in root `tsconfig.json`**

The root `tsconfig.json` already maps `@refarm.dev/*` to `./packages/*/src`, so `@refarm.dev/context-provider-v1` and `@refarm.dev/file-stream-transport` resolve automatically once those packages exist. No additional path entry is needed — verify with:

```bash
grep "context-provider-v1\|file-stream-transport\|stream-contract-v1" tsconfig.json
```

If no output, confirm that the wildcard `"@refarm.dev/*": ["./packages/*/src"]` is present in `tsconfig.json`. It already covers new packages.

- [ ] **Step 3: Update `apps/refarm/src/program.ts` to register `askCommand`**

Add the `askCommand` import and `.addCommand(askCommand)` call. Final `program.ts`:

```typescript
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { sowCommand } from "./commands/sow.js";
import { guideCommand } from "./commands/guide.js";
import { healthCommand } from "./commands/health.js";
import { migrateCommand } from "./commands/migrate.js";
import { deployCommand } from "./commands/deploy.js";
import { pluginCommand } from "./commands/plugin.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";
import { askCommand } from "./commands/ask.js";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(sowCommand);
program.addCommand(guideCommand);
program.addCommand(healthCommand);
program.addCommand(migrateCommand);
program.addCommand(deployCommand);
program.addCommand(pluginCommand);
program.addCommand(statusCommand);
program.addCommand(taskCommand);
program.addCommand(askCommand);
```

- [ ] **Step 4: Run type-check for apps/refarm**

```bash
cd apps/refarm && npm run type-check
```

Expected: passes with no errors. If there are errors about missing `@refarm.dev/stream-contract-v1` (a dep of `@refarm.dev/file-stream-transport`), verify that `packages/stream-contract-v1/` exists (from Slice 7.1). If Slice 7.1 has not yet been implemented, the `@refarm.dev/file-stream-transport` import in `ask.ts` will fail — in that case, defer this task until Slice 7.1 Task 2 is complete.

- [ ] **Step 5: Run all refarm tests**

```bash
cd apps/refarm && npm test
```

Expected: all tests pass including the new `ask.test.ts`.

- [ ] **Step 6: Mark spec tasks done in `specs/features/context-provider-v1.md`**

In `specs/features/context-provider-v1.md`, update the Implementation Tasks section:

Under **SDD**, mark:
```markdown
- [x] Design `ContextProvider` / `ContextRegistry` / `buildSystemPrompt` contract
- [x] Design `refarm ask` command flow
- [x] Write design doc
- [x] No new ADR needed — follows ADR-018 capability contract model
```

Under **TDD**, mark:
```markdown
- [x] `buildSystemPrompt` unit tests in `packages/context-provider-v1/`
- [x] `ContextRegistry` isolation tests
- [x] Provider unit tests (cwd, date, git-status, files)
- [x] `ask` command unit tests in `apps/refarm/`
- [ ] Smoke gate scenario
```

Under **DDD**, mark:
```markdown
- [x] Scaffold `packages/context-provider-v1/` with all types and bundled providers
- [x] Implement `ContextRegistry` with `Promise.allSettled` parallel collection
- [x] Implement `buildSystemPrompt` with priority sorting and XML-style context wrapping
- [x] Add `ask.ts` command to `apps/refarm/src/commands/`
- [x] Wire `refarm ask` in `apps/refarm/src/program.ts`
- [x] Add `@refarm.dev/context-provider-v1` and `@refarm.dev/file-stream-transport`
  as dependencies in `apps/refarm/package.json`
- [ ] Smoke gate: verify end-to-end with stub LLM
```

Also change the top-level **Status** from `Draft` to `In Progress`.

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/program.ts apps/refarm/package.json specs/features/context-provider-v1.md
git commit -m "feat(ask): wire refarm ask into program, add context-provider-v1 deps, update spec"
```

---

## Task 5: Smoke gate — end-to-end `refarm ask` scenario

**Files:**
- Modify: `scripts/ci/smoke-task-execution-loop.mjs`

**Context:** This task extends the existing smoke-task-execution-loop script with an `ask` scenario. The script already has a helper (`runScenario`) for spawning subprocesses and asserting output. The smoke gate requires both Slice 7.1 (stream-contract-v1, specifically `FileStreamTransport` in Farmhand) and this slice to be fully implemented. Do not start this task until Farmhand is writing `StreamChunk` nodes to `~/.refarm/streams/`.

- [ ] **Step 1: Read the current script to understand the scenario pattern**

```bash
cat scripts/ci/smoke-task-execution-loop.mjs | head -100
```

Look for the `runScenario` or equivalent helper and understand how the script:
- Starts Farmhand (or detects a running one)
- Submits work via CLI subprocess
- Asserts output patterns

- [ ] **Step 2: Add the `ask` smoke scenario**

Find the section in `scripts/ci/smoke-task-execution-loop.mjs` where scenarios are registered (look for an array of scenarios or a series of `runScenario(...)` calls). Add the following scenario after the existing pi-agent `respond` scenario:

```javascript
{
  name: "pi-agent ask — context injection + stream output",
  async run(ctx) {
    // Submit via refarm ask
    const askResult = await ctx.spawn(
      "node",
      [ctx.refarmBin, "ask", "what is 2+2?"],
      { timeout: 30_000 }
    );

    // Tokens must appear on stdout
    ctx.assert(
      askResult.stdout.length > 0,
      "ask stdout must not be empty"
    );

    // Usage footer must appear (model line)
    ctx.assert(
      askResult.stdout.includes("model:") || askResult.stdout.includes("tokens:"),
      "ask output must include usage footer"
    );

    // Stream file must exist and contain valid NDJSON
    const effortId = askResult.meta?.effortId;
    if (effortId) {
      const streamFile = path.join(ctx.baseDir, "streams", `${effortId}.ndjson`);
      ctx.assert(
        fs.existsSync(streamFile),
        `stream file must exist at ${streamFile}`
      );
      const lines = fs.readFileSync(streamFile, "utf-8")
        .split("\n")
        .filter(Boolean);
      ctx.assert(lines.length > 0, "stream file must have at least one chunk");
      for (const line of lines) {
        const chunk = JSON.parse(line);
        ctx.assert(typeof chunk.stream_ref === "string", "chunk must have stream_ref");
        ctx.assert(typeof chunk.is_final === "boolean", "chunk must have is_final");
      }
    }
  }
}
```

Note: The exact API of `ctx` (e.g., `ctx.spawn`, `ctx.assert`, `ctx.baseDir`, `ctx.refarmBin`) must match what the existing script provides. Read the current script (`step 1`) before writing this step — adapt the scenario to use the actual helpers available.

- [ ] **Step 3: Run the smoke gate locally**

```bash
node scripts/ci/smoke-task-execution-loop.mjs
```

Expected: all scenarios pass, including the new `ask` scenario.

If the `ask` scenario fails with a connection error (Farmhand not running), start Farmhand first:

```bash
# In a separate terminal
node apps/farmhand/dist/index.js &
FARMHAND_PID=$!
node scripts/ci/smoke-task-execution-loop.mjs
kill $FARMHAND_PID
```

- [ ] **Step 4: Update `specs/features/context-provider-v1.md` smoke gate checkbox**

Mark the smoke gate as done:

```markdown
- [x] Smoke gate scenario
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/smoke-task-execution-loop.mjs specs/features/context-provider-v1.md
git commit -m "test(ask): add smoke gate scenario for refarm ask with stream output"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `ContextProvider` / `ContextRegistry` / `buildSystemPrompt` contract | Task 1 |
| `CwdContextProvider` (priority 10) | Task 2 |
| `DateContextProvider` (priority 20) | Task 2 |
| `GitStatusContextProvider` (priority 30) — silent on missing git | Task 2 |
| `FilesContextProvider` (priority 50) — 4 KB truncation | Task 2 |
| `ContextRegistry` parallel `Promise.allSettled` — isolates failures | Task 1 |
| `refarm ask "<query>"` command | Task 3 |
| `--files f1,f2` flag — file content in system prompt | Task 3 |
| POST `/efforts` with `{ pluginId:"pi-agent", fn:"respond", args:{ prompt, system } }` | Task 3 |
| Subscribe to file stream for `effortId`, print tokens | Task 3 |
| Print usage footer on `is_final` (`model`, `tokens_in`, `tokens_out`, `estimated_usd`) | Task 3 |
| Wire `refarm ask` in `program.ts` + add deps in `package.json` | Task 4 |
| Late-starting subscriber still replays past chunks (AC#5) | Task 3 — file poll replays from offset 0 |
| Smoke gate | Task 5 |

All spec requirements covered.

**Placeholder scan:** No TBD, TODO, or "implement later" placeholders. All code blocks are complete. Step 5 of Task 5 has a conditional note about adapting to the actual `ctx` API — but includes a concrete action (read the file first) rather than leaving it vague.

**Type consistency check:**
- `AskDeps.submitEffort` accepts `Effort` (from `@refarm.dev/effort-contract-v1`) — consistent with `task.ts` pattern.
- `AskDeps.followStream` uses `StreamChunk` (from `@refarm.dev/stream-contract-v1`) — consistent with what `FileStreamTransport` writes.
- `ContextRegistry.collect()` returns `Promise<ContextEntry[]>` — consumed by `buildSystemPrompt(entries: ContextEntry[])` — consistent.
- `FilesContextProvider(files: string[])` constructor — consistent with `ContextRegistry` test `makeProvider` and `ask.ts` usage.
- `CONTEXT_CAPABILITY = "context:v1"` used in all four providers — consistent with `types.ts` definition.
