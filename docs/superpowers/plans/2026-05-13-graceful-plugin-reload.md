# Graceful Plugin Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/reload` in the `refarm` REPL reload plugins gracefully — immediately if idle, deferred until in-flight tasks complete if busy — with per-plugin status and coalescing of concurrent reload requests.

**Architecture:** New `PluginUsageTracker` (EventEmitter) tracks `pluginId → Set<effortId>`; `FileTransportAdapter` gains optional `onEffortStart`/`onEffortEnd` hooks that feed the tracker; `POST /plugins/reload` returns `reloadId` for polling via `GET /plugins/reload/status/:reloadId`; existing `reloadPluginsViaHttp` in `chat.ts` updated to use the new contract with polling loop.

**Tech Stack:** Node.js EventEmitter, Vitest, native `fetch`, existing `HttpSidecar` test pattern.

**⚠ Prerequisite:** Complete `2026-05-13-llm-to-model-rename.md` before starting this plan — both plans touch `apps/farmhand/src/index.ts`.

---

## File Map

| File | Change |
|---|---|
| `apps/farmhand/src/plugin-usage-tracker.ts` | **Create** — new class |
| `apps/farmhand/src/plugin-usage-tracker.test.ts` | **Create** — unit tests |
| `apps/farmhand/src/installed-plugins.ts` | Add `listInstalledPluginIds()` + `pluginFilter` option to `loadInstalledPlugins` |
| `apps/farmhand/src/installed-plugins.test.ts` | Add tests for new exports |
| `apps/farmhand/src/transports/file.ts` | Add `FileTransportOptions` interface + hook calls in `processEffort` |
| `apps/farmhand/src/transports/file.test.ts` | Add hook tests |
| `apps/farmhand/src/transports/plugins.ts` | Full rewrite — deferred reload + status endpoint |
| `apps/farmhand/src/transports/plugins.test.ts` | Full rewrite of tests |
| `apps/farmhand/src/index.ts` | Wire `PluginUsageTracker` |
| `apps/refarm/src/commands/chat-repl.ts` | Add `pluginIds: string[]` to `reload` command type |
| `apps/refarm/src/commands/chat.ts` | Update `reloadPlugins` contract + `reloadPluginsViaHttp` + REPL handler |

---

## Task 1: PluginUsageTracker

**Files:**
- Create: `apps/farmhand/src/plugin-usage-tracker.ts`
- Create: `apps/farmhand/src/plugin-usage-tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/farmhand/src/plugin-usage-tracker.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginUsageTracker } from "./plugin-usage-tracker.js";

describe("PluginUsageTracker", () => {
  let tracker: PluginUsageTracker;

  beforeEach(() => {
    tracker = new PluginUsageTracker();
  });

  describe("isIdle", () => {
    it("returns true for an unknown plugin", () => {
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });

    it("returns false after registerEffort for that plugin", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      expect(tracker.isIdle("plugin-a")).toBe(false);
    });

    it("returns true after the only effort is released", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });

    it("remains false while a second effort still holds the plugin", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      tracker.registerEffort("e2", ["plugin-a"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(false);
      tracker.releaseEffort("e2");
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });
  });

  describe("releaseEffort", () => {
    it("is a no-op for an unknown effort id", () => {
      expect(() => tracker.releaseEffort("ghost")).not.toThrow();
    });

    it("releases all plugins referenced by the effort", () => {
      tracker.registerEffort("e1", ["plugin-a", "plugin-b"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(true);
      expect(tracker.isIdle("plugin-b")).toBe(true);
    });
  });

  describe("onIdle", () => {
    it("fires callback immediately when plugin is already idle", () => {
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("fires callback when plugin transitions to idle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      expect(cb).not.toHaveBeenCalled();
      tracker.releaseEffort("e1");
      expect(cb).toHaveBeenCalledOnce();
    });

    it("fires exactly once — not on a subsequent idle cycle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      tracker.releaseEffort("e1");
      // re-register + re-release
      tracker.registerEffort("e2", ["plugin-a"]);
      tracker.releaseEffort("e2");
      expect(cb).toHaveBeenCalledOnce();
    });

    it("multiple callbacks all fire when the plugin goes idle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      tracker.onIdle("plugin-a", cb1);
      tracker.onIdle("plugin-a", cb2);
      tracker.releaseEffort("e1");
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd apps/farmhand && npm test -- --reporter verbose plugin-usage-tracker 2>&1 | tail -15
```

Expected: fail with `Cannot find module './plugin-usage-tracker.js'`.

- [ ] **Step 3: Implement PluginUsageTracker**

```typescript
// apps/farmhand/src/plugin-usage-tracker.ts
import { EventEmitter } from "node:events";

export class PluginUsageTracker extends EventEmitter {
  private readonly effortPlugins = new Map<string, Set<string>>();
  private readonly pluginEfforts = new Map<string, Set<string>>();

  registerEffort(effortId: string, pluginIds: string[]): void {
    const plugins = new Set(pluginIds);
    this.effortPlugins.set(effortId, plugins);
    for (const pluginId of plugins) {
      let efforts = this.pluginEfforts.get(pluginId);
      if (!efforts) {
        efforts = new Set();
        this.pluginEfforts.set(pluginId, efforts);
      }
      efforts.add(effortId);
    }
  }

  releaseEffort(effortId: string): void {
    const plugins = this.effortPlugins.get(effortId);
    if (!plugins) return;
    this.effortPlugins.delete(effortId);
    for (const pluginId of plugins) {
      const efforts = this.pluginEfforts.get(pluginId);
      if (!efforts) continue;
      efforts.delete(effortId);
      if (efforts.size === 0) {
        this.pluginEfforts.delete(pluginId);
        this.emit(`idle:${pluginId}`);
      }
    }
  }

  isIdle(pluginId: string): boolean {
    const efforts = this.pluginEfforts.get(pluginId);
    return !efforts || efforts.size === 0;
  }

  onIdle(pluginId: string, callback: () => void): void {
    if (this.isIdle(pluginId)) {
      callback();
      return;
    }
    this.once(`idle:${pluginId}`, callback);
  }
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd apps/farmhand && npm test -- --reporter verbose plugin-usage-tracker 2>&1 | tail -15
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/plugin-usage-tracker.ts \
        apps/farmhand/src/plugin-usage-tracker.test.ts
git commit -m "feat(farmhand): PluginUsageTracker — tracks plugin usage per effort, emits idle events"
```

---

## Task 2: installed-plugins additions

**Files:**
- Modify: `apps/farmhand/src/installed-plugins.ts`
- Modify: `apps/farmhand/src/installed-plugins.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/farmhand/src/installed-plugins.test.ts` (after the existing imports and helpers):

```typescript
import { listInstalledPluginIds, loadInstalledPlugins } from "./installed-plugins.js";

// --- NEW: listInstalledPluginIds ---

describe("listInstalledPluginIds", () => {
  it("returns empty array when plugins directory does not exist", () => {
    const baseDir = createTempDir();
    expect(listInstalledPluginIds(baseDir)).toEqual([]);
  });

  it("returns ids of all installed plugins", () => {
    const baseDir = createTempDir();
    const pluginsDir = path.join(baseDir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    for (const id of ["plugin-a", "plugin-b"]) {
      const dir = path.join(pluginsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify(createMockManifest({ id, entry: `${id}.wasm` })),
        "utf-8",
      );
    }

    const ids = listInstalledPluginIds(baseDir);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("plugin-a");
    expect(ids).toContain("plugin-b");
  });

  it("silently skips invalid manifests", () => {
    const baseDir = createTempDir();
    const pluginsDir = path.join(baseDir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    const dir = path.join(pluginsDir, "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "not-json", "utf-8");

    expect(listInstalledPluginIds(baseDir)).toEqual([]);
  });
});

// --- NEW: loadInstalledPlugins with pluginFilter ---

describe("loadInstalledPlugins — pluginFilter", () => {
  it("loads only plugins whose id appears in pluginFilter", async () => {
    const baseDir = createTempDir();
    const pluginsDir = path.join(baseDir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    for (const id of ["plugin-a", "plugin-b"]) {
      const dir = path.join(pluginsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify(createMockManifest({ id, entry: `${id}.wasm` })),
        "utf-8",
      );
    }

    const tractor = createTractorStub();
    await loadInstalledPlugins(tractor, baseDir, { pluginFilter: ["plugin-a"] });

    expect(tractor.plugins.load).toHaveBeenCalledOnce();
    expect(tractor.plugins.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plugin-a" }),
    );
  });

  it("loads all plugins when pluginFilter is absent", async () => {
    const baseDir = createTempDir();
    const pluginsDir = path.join(baseDir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    for (const id of ["plugin-a", "plugin-b"]) {
      const dir = path.join(pluginsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify(createMockManifest({ id, entry: `${id}.wasm` })),
        "utf-8",
      );
    }

    const tractor = createTractorStub();
    await loadInstalledPlugins(tractor, baseDir);
    expect(tractor.plugins.load).toHaveBeenCalledTimes(2);
  });
});
```

Also update the **existing** test on line 42 — the signature changes (logger moves to 4th param):

```typescript
// OLD
const summary = await loadInstalledPlugins(tractor, baseDir, logger);
// NEW
const summary = await loadInstalledPlugins(tractor, baseDir, undefined, logger);
```

Do the same for any other existing test that passes `logger` as the 3rd argument.

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
cd apps/farmhand && npm test -- --reporter verbose installed-plugins 2>&1 | tail -15
```

Expected: new tests fail, existing tests may also fail on the signature change.

- [ ] **Step 3: Update `installed-plugins.ts`**

```typescript
// apps/farmhand/src/installed-plugins.ts

// ADD new export (before loadInstalledPlugins):
export function listInstalledPluginIds(baseDir: string): string[] {
  const pluginsDir = path.join(baseDir, "plugins");
  if (!fs.existsSync(pluginsDir)) return [];

  const pluginDirs = findPluginDirs(pluginsDir);
  const ids: string[] = [];
  for (const pluginDir of pluginDirs) {
    try {
      const manifest = readManifestFromDir(pluginDir);
      ids.push(manifest.id);
    } catch {
      // skip unreadable manifests silently
    }
  }
  return ids;
}

// MODIFY loadInstalledPlugins signature — move logger to 4th param, add options 3rd:
export async function loadInstalledPlugins(
  tractor: PluginLoaderTarget,
  baseDir: string,
  options?: { pluginFilter?: string[] },
  logger: LoggerLike = console,
): Promise<{ loaded: number; skipped: number }> {
  const pluginsDir = path.join(baseDir, "plugins");
  if (!fs.existsSync(pluginsDir)) {
    return { loaded: 0, skipped: 0 };
  }

  const pluginDirs = findPluginDirs(pluginsDir);
  let loaded = 0;
  let skipped = 0;

  for (const pluginDir of pluginDirs) {
    try {
      const manifest = readManifestFromDir(pluginDir);
      // ADDED: skip plugins not in the filter (when filter is provided)
      if (options?.pluginFilter && !options.pluginFilter.includes(manifest.id)) {
        continue;
      }
      await tractor.registry.register(manifest);
      await tractor.registry.trust(manifest.id);
      await tractor.plugins.load(manifest);
      loaded += 1;
      logger.info(
        `[farmhand] Installed plugin loaded: ${manifest.id} (${manifest.version})`,
      );
    } catch (error: unknown) {
      skipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      const pluginLabel = path.relative(path.join(baseDir, "plugins"), pluginDir) || pluginDir;
      logger.warn(
        `[farmhand] Failed to load installed plugin ${pluginLabel}: ${message}`,
      );
    }
  }

  return { loaded, skipped };
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
cd apps/farmhand && npm test -- --reporter verbose installed-plugins 2>&1 | tail -20
```

Expected: all tests pass including existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/installed-plugins.ts \
        apps/farmhand/src/installed-plugins.test.ts
git commit -m "feat(farmhand): listInstalledPluginIds + pluginFilter option for loadInstalledPlugins"
```

---

## Task 3: FileTransportAdapter hooks

**Files:**
- Modify: `apps/farmhand/src/transports/file.ts`
- Modify: `apps/farmhand/src/transports/file.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/farmhand/src/transports/file.test.ts`. Read the file first to understand its existing helpers, then add:

```typescript
describe("FileTransportAdapter — lifecycle hooks", () => {
  it("calls onEffortStart with effortId and all plugin ids before processing", async () => {
    const onEffortStart = vi.fn();
    const adapter = makeAdapter({ onEffortStart }); // see step 3 for makeAdapter signature
    const effort = makeEffort([
      makeTask({ pluginId: "plugin-a" }),
      makeTask({ pluginId: "plugin-b" }),
    ]);
    await adapter.process(effort);
    expect(onEffortStart).toHaveBeenCalledOnce();
    expect(onEffortStart).toHaveBeenCalledWith(
      effort.id,
      expect.arrayContaining(["plugin-a", "plugin-b"]),
    );
  });

  it("calls onEffortEnd with effortId after processing completes", async () => {
    const onEffortEnd = vi.fn();
    const adapter = makeAdapter({ onEffortEnd });
    const effort = makeEffort([makeTask({ pluginId: "plugin-a" })]);
    await adapter.process(effort);
    expect(onEffortEnd).toHaveBeenCalledOnce();
    expect(onEffortEnd).toHaveBeenCalledWith(effort.id);
  });

  it("calls onEffortEnd even when the executor throws", async () => {
    const onEffortEnd = vi.fn();
    const throwingExecutor = vi.fn().mockRejectedValue(new Error("boom"));
    const adapter = makeAdapterWithExecutor(throwingExecutor, { onEffortEnd });
    const effort = makeEffort([makeTask({ pluginId: "plugin-a" })]);
    await adapter.process(effort);
    expect(onEffortEnd).toHaveBeenCalledWith(effort.id);
  });

  it("does not call hooks when options are not provided", async () => {
    // Existing tests use makeAdapter() without hooks — should not throw
    const adapter = makeAdapter();
    const effort = makeEffort([makeTask({ pluginId: "plugin-a" })]);
    await expect(adapter.process(effort)).resolves.not.toThrow();
  });
});
```

The test helpers `makeAdapter`, `makeAdapterWithExecutor`, `makeEffort`, `makeTask` — read the existing test file to see what helpers already exist and adapt them. Add `options?: FileTransportOptions` parameter to whichever factory function creates the adapter.

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
cd apps/farmhand && npm test -- --reporter verbose "transports/file" 2>&1 | tail -15
```

Expected: new tests fail because `FileTransportAdapter` does not yet accept options.

- [ ] **Step 3: Add `FileTransportOptions` to `file.ts`**

```typescript
// ADD interface (before the class):
export interface FileTransportOptions {
  onEffortStart?: (effortId: string, pluginIds: string[]) => void;
  onEffortEnd?: (effortId: string) => void;
}

// MODIFY constructor:
constructor(
  baseDir: string,
  private readonly executor: TaskExecutorFn,
  private readonly options: FileTransportOptions = {},
) {
  // ... existing body unchanged
}
```

- [ ] **Step 4: Add hook calls inside `processEffort`**

In `processEffort`, after `this.inFlightEfforts.add(effort.id)`:

```typescript
// BEFORE the try block, after inFlightEfforts.add():
const pluginIds = effort.tasks.map((t) => t.pluginId);
this.options.onEffortStart?.(effort.id, pluginIds);
```

In the `finally` block, after `this.inFlightEfforts.delete(effort.id)`:

```typescript
// AFTER inFlightEfforts.delete(), still in finally:
this.options.onEffortEnd?.(effort.id);
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
cd apps/farmhand && npm test -- --reporter verbose "transports/file" 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/src/transports/file.ts \
        apps/farmhand/src/transports/file.test.ts
git commit -m "feat(farmhand): FileTransportAdapter onEffortStart/onEffortEnd hooks"
```

---

## Task 4: Rewrite createPluginsRouteHandler

**Files:**
- Modify: `apps/farmhand/src/transports/plugins.ts`
- Modify: `apps/farmhand/src/transports/plugins.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the contents of `apps/farmhand/src/transports/plugins.test.ts`:

```typescript
import crypto from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpSidecar } from "./http.js";
import { createPluginsRouteHandler } from "./plugins.js";
import { PluginUsageTracker } from "../plugin-usage-tracker.js";

vi.mock("../installed-plugins.js", () => ({
  loadInstalledPlugins: vi.fn().mockResolvedValue({ loaded: 1, skipped: 0 }),
  listInstalledPluginIds: vi.fn().mockReturnValue(["plugin-a"]),
}));

import { loadInstalledPlugins, listInstalledPluginIds } from "../installed-plugins.js";

function makeTarget() {
  return {
    registry: {
      register: vi.fn().mockResolvedValue(undefined),
      trust: vi.fn().mockResolvedValue(undefined),
    },
    plugins: { load: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeTracker(idle = true) {
  const tracker = new PluginUsageTracker();
  if (!idle) {
    tracker.registerEffort("e1", ["plugin-a"]);
  }
  return tracker;
}

async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
        agent: false,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data || "null") }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("createPluginsRouteHandler", () => {
  let sidecar: HttpSidecar;
  let port: number;
  let target: ReturnType<typeof makeTarget>;
  let tracker: PluginUsageTracker;

  async function startSidecar(idle = true) {
    target = makeTarget();
    tracker = makeTracker(idle);
    sidecar = new HttpSidecar(0, {
      submit: vi.fn(), query: vi.fn(), list: vi.fn(), logs: vi.fn(),
      retry: vi.fn(), cancel: vi.fn(), summary: vi.fn(), process: vi.fn(),
    });
    sidecar.addRouteHandler(createPluginsRouteHandler(target, "/tmp/test-refarm", tracker));
    await sidecar.start();
    port = (sidecar.httpServer.address() as { port: number }).port;
  }

  afterEach(async () => {
    await sidecar.stop();
    vi.clearAllMocks();
  });

  describe("POST /plugins/reload — immediate (plugin idle)", () => {
    beforeEach(() => startSidecar(true));

    it("returns 200 with reloadId, reloaded[], empty deferred[]", async () => {
      const res = await request(port, "POST", "/plugins/reload");
      expect(res.status).toBe(200);
      const body = res.body as { reloadId: string; reloaded: string[]; deferred: string[]; skipped: string[] };
      expect(typeof body.reloadId).toBe("string");
      expect(body.reloaded).toContain("plugin-a");
      expect(body.deferred).toEqual([]);
    });

    it("calls loadInstalledPlugins with pluginFilter for each plugin", async () => {
      await request(port, "POST", "/plugins/reload");
      expect(loadInstalledPlugins).toHaveBeenCalledWith(
        target,
        "/tmp/test-refarm",
        { pluginFilter: ["plugin-a"] },
      );
    });

    it("uses requested pluginIds from body when provided", async () => {
      vi.mocked(listInstalledPluginIds).mockReturnValueOnce(["plugin-a", "plugin-b"]);
      const res = await request(port, "POST", "/plugins/reload", { pluginIds: ["plugin-a"] });
      expect(res.status).toBe(200);
      const body = res.body as { reloaded: string[] };
      expect(body.reloaded).toEqual(["plugin-a"]);
      expect(listInstalledPluginIds).not.toHaveBeenCalled();
    });

    it("returns 405 for GET /plugins/reload", async () => {
      const res = await request(port, "GET", "/plugins/reload");
      expect(res.status).toBe(405);
    });
  });

  describe("POST /plugins/reload — deferred (plugin busy)", () => {
    beforeEach(() => startSidecar(false)); // tracker has effort registered

    it("returns deferred[] when plugin has in-flight effort", async () => {
      const res = await request(port, "POST", "/plugins/reload");
      expect(res.status).toBe(200);
      const body = res.body as { reloaded: string[]; deferred: string[] };
      expect(body.reloaded).toEqual([]);
      expect(body.deferred).toContain("plugin-a");
    });

    it("executes reload when tracker fires idle and updates status", async () => {
      const res = await request(port, "POST", "/plugins/reload");
      const { reloadId } = res.body as { reloadId: string };

      // status is pending before idle
      const beforeIdle = await request(port, "GET", `/plugins/reload/status/${reloadId}`);
      expect((beforeIdle.body as { pending: string[] }).pending).toContain("plugin-a");

      // simulate effort completing → plugin becomes idle → deferred reload fires
      tracker.releaseEffort("e1");
      await new Promise((r) => setTimeout(r, 50)); // let async reload settle

      const afterIdle = await request(port, "GET", `/plugins/reload/status/${reloadId}`);
      const afterBody = afterIdle.body as { pending: string[]; completed: string[] };
      expect(afterBody.pending).toEqual([]);
      expect(afterBody.completed).toContain("plugin-a");
    });
  });

  describe("GET /plugins/reload/status/:reloadId", () => {
    beforeEach(() => startSidecar(true));

    it("returns 404 for an unknown reloadId", async () => {
      const res = await request(port, "GET", `/plugins/reload/status/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not found" });
    });

    it("does not intercept unrelated routes", async () => {
      const res = await request(port, "GET", "/efforts");
      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd apps/farmhand && npm test -- --reporter verbose "transports/plugins" 2>&1 | tail -15
```

Expected: tests fail because the handler signature doesn't accept `tracker` yet.

- [ ] **Step 3: Rewrite `plugins.ts`**

```typescript
// apps/farmhand/src/transports/plugins.ts
import crypto from "node:crypto";
import type http from "node:http";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { listInstalledPluginIds, loadInstalledPlugins } from "../installed-plugins.js";
import type { PluginUsageTracker } from "../plugin-usage-tracker.js";

export interface PluginReloadTarget {
  registry: {
    register(manifest: PluginManifest, sourceUrl?: string): Promise<string>;
    trust(pluginId: string): Promise<void>;
  };
  plugins: {
    load(manifest: PluginManifest): Promise<unknown>;
  };
}

const RELOAD_STATUS_TTL_MS = 5 * 60 * 1_000;

interface ReloadStatus {
  pending: Set<string>;
  completed: Set<string>;
  failed: Set<string>;
  createdAt: number;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? (JSON.parse(data) as T) : null); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

export function createPluginsRouteHandler(
  target: PluginReloadTarget,
  baseDir: string,
  tracker: PluginUsageTracker,
) {
  const reloadStatuses = new Map<string, ReloadStatus>();
  const pendingPluginReloads = new Map<string, Set<string>>();

  function evictStale(): void {
    const now = Date.now();
    for (const [id, status] of reloadStatuses) {
      if (now - status.createdAt > RELOAD_STATUS_TTL_MS) reloadStatuses.delete(id);
    }
  }

  async function performReload(pluginId: string, watchers: Set<string>): Promise<void> {
    try {
      await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
      for (const wId of watchers) {
        const s = reloadStatuses.get(wId);
        if (s) { s.pending.delete(pluginId); s.completed.add(pluginId); }
      }
    } catch (err) {
      console.error(
        `[farmhand] Failed to reload plugin "${pluginId}":`,
        err instanceof Error ? err.message : String(err),
      );
      for (const wId of watchers) {
        const s = reloadStatuses.get(wId);
        if (s) { s.pending.delete(pluginId); s.failed.add(pluginId); }
      }
    }
  }

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

    // GET /plugins/reload/status/:reloadId
    const statusMatch = requestUrl.pathname.match(/^\/plugins\/reload\/status\/([^/]+)$/u);
    if (statusMatch) {
      evictStale();
      const reloadId = statusMatch[1]!;
      const status = reloadStatuses.get(reloadId);
      if (!status) {
        json(res, 404, { error: "not found" });
      } else {
        json(res, 200, {
          reloadId,
          pending: [...status.pending],
          completed: [...status.completed],
          failed: [...status.failed],
        });
      }
      return true;
    }

    if (requestUrl.pathname !== "/plugins/reload") return false;

    void (async () => {
      try {
        if (req.method !== "POST") {
          json(res, 405, { error: "method not allowed" });
          return;
        }

        evictStale();

        const body = await readJsonBody<{ pluginIds?: unknown }>(req);
        const pluginIds =
          Array.isArray(body?.pluginIds) &&
          (body.pluginIds as unknown[]).every((id) => typeof id === "string")
            ? (body.pluginIds as string[])
            : listInstalledPluginIds(baseDir);

        const reloadId = crypto.randomUUID();
        const status: ReloadStatus = {
          pending: new Set(),
          completed: new Set(),
          failed: new Set(),
          createdAt: Date.now(),
        };
        reloadStatuses.set(reloadId, status);

        for (const pluginId of pluginIds) {
          if (tracker.isIdle(pluginId)) {
            try {
              await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
              status.completed.add(pluginId);
            } catch (err) {
              console.error(
                `[farmhand] Failed to reload plugin "${pluginId}":`,
                err instanceof Error ? err.message : String(err),
              );
              status.failed.add(pluginId);
            }
          } else {
            status.pending.add(pluginId);
            const existing = pendingPluginReloads.get(pluginId);
            if (existing) {
              existing.add(reloadId);
            } else {
              const watchers = new Set([reloadId]);
              pendingPluginReloads.set(pluginId, watchers);
              tracker.onIdle(pluginId, () => {
                pendingPluginReloads.delete(pluginId);
                void performReload(pluginId, watchers);
              });
            }
          }
        }

        json(res, 200, {
          reloadId,
          reloaded: [...status.completed],
          deferred: [...status.pending],
          skipped: [...status.failed],
        });
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return true;
  };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd apps/farmhand && npm test -- --reporter verbose "transports/plugins" 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/transports/plugins.ts \
        apps/farmhand/src/transports/plugins.test.ts
git commit -m "feat(farmhand): graceful plugin reload — deferred per plugin, status polling, coalescing"
```

---

## Task 5: Wire PluginUsageTracker in `index.ts`

**Files:**
- Modify: `apps/farmhand/src/index.ts`

- [ ] **Step 1: Add import**

At the top of `apps/farmhand/src/index.ts`, add:

```typescript
import { PluginUsageTracker } from "./plugin-usage-tracker.js";
```

- [ ] **Step 2: Create tracker and wire into FileTransportAdapter**

Find the `const fileTransport = new FileTransportAdapter(...)` line (around line 287) and update it:

```typescript
// BEFORE (existing)
const fileTransport = new FileTransportAdapter(
  farmhandBaseDir,
  taskExecutorFn,
);

// AFTER
const pluginTracker = new PluginUsageTracker();
const fileTransport = new FileTransportAdapter(
  farmhandBaseDir,
  taskExecutorFn,
  {
    onEffortStart: (effortId, pluginIds) => pluginTracker.registerEffort(effortId, pluginIds),
    onEffortEnd:   (effortId)            => pluginTracker.releaseEffort(effortId),
  },
);
```

- [ ] **Step 3: Pass tracker to route handler**

Find the `createPluginsRouteHandler` call (around line 295) and update it:

```typescript
// BEFORE
httpSidecar.addRouteHandler(createPluginsRouteHandler(tractor, farmhandBaseDir));

// AFTER
httpSidecar.addRouteHandler(createPluginsRouteHandler(tractor, farmhandBaseDir, pluginTracker));
```

- [ ] **Step 4: Run farmhand tests**

```bash
cd apps/farmhand && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/index.ts
git commit -m "feat(farmhand): wire PluginUsageTracker into FileTransportAdapter and plugins route"
```

---

## Task 6: Update CLI `/reload` command

**Files:**
- Modify: `apps/refarm/src/commands/chat-repl.ts`
- Modify: `apps/refarm/src/commands/chat.ts`

- [ ] **Step 1: Update `chat-repl.ts` — add pluginIds to reload command**

```typescript
// MODIFY the ChatCommand union type:
export type ChatCommand =
  | { kind: "message"; text: string }
  | { kind: "reload"; pluginIds: string[] }  // was: { kind: "reload" }
  | { kind: "new" }
  | { kind: "session"; prefix: string }
  | { kind: "exit" }
  | { kind: "help" };

// REMOVE "reload" from SLASH_COMMANDS (it now needs arg parsing like "session"):
const SLASH_COMMANDS: Record<string, ChatCommand> = {
  // "reload" removed — handled explicitly below
  new:  { kind: "new" },
  exit: { kind: "exit" },
  quit: { kind: "exit" },
  help: { kind: "help" },
};

// MODIFY parseChatLine — add reload case before the SLASH_COMMANDS lookup:
export function parseChatLine(line: string): ChatCommand {
  const trimmed = line.trim();

  if (!trimmed.startsWith("/")) {
    return { kind: "message", text: trimmed };
  }

  const withoutSlash = trimmed.slice(1);
  const [name, ...rest] = withoutSlash.split(/\s+/);
  const commandName = (name ?? "").toLowerCase();

  if (commandName === "session") {
    const prefix = rest.join(" ").trim();
    return prefix.length > 0
      ? { kind: "session", prefix }
      : { kind: "message", text: trimmed };
  }

  // NEW — reload with optional plugin ids
  if (commandName === "reload") {
    return { kind: "reload", pluginIds: rest.filter(Boolean) };
  }

  return SLASH_COMMANDS[commandName] ?? { kind: "message", text: trimmed };
}
```

- [ ] **Step 2: Run chat-repl tests (if any)**

```bash
cd apps/refarm && npm test -- --reporter verbose chat-repl 2>&1 | tail -15
```

If tests exist, ensure `/reload` parsing tests cover the `pluginIds` field. Add them if missing:

```typescript
it("parses /reload with no args — empty pluginIds", () => {
  expect(parseChatLine("/reload")).toEqual({ kind: "reload", pluginIds: [] });
});

it("parses /reload with plugin ids", () => {
  expect(parseChatLine("/reload pi-agent my-plugin")).toEqual({
    kind: "reload",
    pluginIds: ["pi-agent", "my-plugin"],
  });
});
```

- [ ] **Step 3: Update `ChatDeps.reloadPlugins` signature in `chat.ts`**

```typescript
// MODIFY ChatDeps interface:
export interface ChatDeps {
  // ... existing fields ...
  reloadPlugins(pluginIds?: string[]): Promise<{ reloaded: string[]; skipped: string[] }>;
  // ...
}
```

- [ ] **Step 4: Rewrite `reloadPluginsViaHttp` in `chat.ts`**

```typescript
async function reloadPluginsViaHttp(
  pluginIds?: string[],
): Promise<{ reloaded: string[]; skipped: string[] }> {
  const response = await fetch(`${SIDECAR_URL}/plugins/reload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: pluginIds ? JSON.stringify({ pluginIds }) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Farmhand HTTP ${response.status}`);
  }

  const { reloadId, reloaded, deferred, skipped } = (await response.json()) as {
    reloadId: string;
    reloaded: string[];
    deferred: string[];
    skipped: string[];
  };

  if (deferred.length === 0) {
    return { reloaded, skipped };
  }

  // Poll until all deferred reloads complete
  const pending = new Set(deferred);
  const completed = new Set(reloaded);
  const failed = new Set(skipped);

  for (const p of deferred) {
    process.stdout.write(chalk.yellow(`⏳ ${p}: waiting for active tasks...\n`));
  }

  while (pending.size > 0) {
    await new Promise<void>((r) => setTimeout(r, 500));

    const statusRes = await fetch(
      `${SIDECAR_URL}/plugins/reload/status/${reloadId}`,
    );
    if (!statusRes.ok) break;

    const status = (await statusRes.json()) as {
      pending: string[];
      completed: string[];
      failed: string[];
    };

    for (const p of status.completed) {
      if (pending.delete(p)) completed.add(p);
    }
    for (const p of status.failed) {
      if (pending.delete(p)) failed.add(p);
    }
    // Evict plugins the server no longer tracks as pending
    for (const p of [...pending]) {
      if (!status.pending.includes(p)) {
        pending.delete(p);
        if (!completed.has(p)) failed.add(p);
      }
    }
  }

  return { reloaded: [...completed], skipped: [...failed] };
}
```

- [ ] **Step 5: Update `defaultChatDeps` in `chat.ts`**

```typescript
export function defaultChatDeps(): ChatDeps {
  return {
    // ... existing fields ...
    reloadPlugins: reloadPluginsViaHttp,
    // ...
  };
}
```

- [ ] **Step 6: Update the `case "reload"` handler in `runSessionRepl`**

```typescript
case "reload":
  rl.pause();
  void (async () => {
    try {
      const ids = command.pluginIds;
      const { reloaded, skipped } = await deps.reloadPlugins(
        ids.length > 0 ? ids : undefined,
      );
      for (const p of reloaded) {
        console.log(chalk.green(`✓  ${p} reloaded`));
      }
      for (const p of skipped) {
        console.error(chalk.red(`✗  ${p} failed to reload`));
      }
      if (reloaded.length === 0 && skipped.length === 0) {
        console.log(chalk.dim("No plugins to reload."));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`✗  ${message}`));
    }
    console.log();
    rl.resume();
    rl.prompt();
  })();
  break;
```

- [ ] **Step 7: Run refarm tests**

```bash
cd apps/refarm && npm test 2>&1 | tail -20
```

Expected: all tests pass. Pay special attention to any test that mocks `reloadPlugins` — update the mock return shape from `{ reloaded: number, skipped: number }` to `{ reloaded: string[], skipped: string[] }`.

- [ ] **Step 8: Commit**

```bash
git add apps/refarm/src/commands/chat-repl.ts \
        apps/refarm/src/commands/chat.ts
git commit -m "feat(refarm): /reload [pluginIds] — polling loop, per-plugin status, updated contract"
```

---

## Final verification

- [ ] **Run all farmhand tests**

```bash
cd apps/farmhand && npm test 2>&1 | tail -20
```

Expected: all suites pass.

- [ ] **Run all refarm tests**

```bash
cd apps/refarm && npm test 2>&1 | tail -20
```

Expected: all suites pass.

- [ ] **Build the CLI**

```bash
cd /workspaces/refarm && npm run cli:build 2>&1 | tail -10
```

Expected: compiles without errors.

- [ ] **Smoke test `/reload` in the REPL**

```bash
refarm
# In the REPL:
/reload
```

Expected: prints `✓ <plugin-id> reloaded` (or `No plugins to reload.` if none installed), returns to `›` prompt.
