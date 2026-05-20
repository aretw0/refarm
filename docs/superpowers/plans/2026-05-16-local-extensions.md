# Local Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create JS-native local extensions (zero build step) that farmhand loads at boot and reloads with `/reload` — scoped to a project (`.refarm/extensions/`) or global (`~/.refarm/extensions/`), with a clear path to promote to a published WASM plugin later.

**Architecture:** Tractor's `PluginHost.load()` already has a native JS branch: when `manifest.entry` ends in `.js`, it skips JCO and calls `import(entryUrl)` directly (`plugin-host.ts:212`). Local extensions exploit this: `ext.json` (simple descriptor) + `index.js` (the implementation) live in `.refarm/extensions/<name>/`. A new `loadLocalExtensions()` in farmhand scans both the project dir and `~/.refarm/extensions/`, constructs full `PluginManifest` objects, and loads them via the same `register → trust → load` pipeline used for installed WASM plugins. The `/reload` handler in `transports/plugins.ts` is extended to include `@local/*` IDs and route them to `loadLocalExtensions` instead of `loadInstalledPlugins`. `refarm extension new/list/save` provide the developer workflow.

**Tech Stack:** Node.js `node:fs`, `node:url` (`pathToFileURL`), Commander (CLI commands), tractor's existing `PluginHost` (no tractor changes needed), `@refarm.dev/plugin-manifest` (`PluginManifest` type).

---

## File Structure

Files to create:
- `apps/farmhand/src/local-extensions.ts` — `loadLocalExtensions()` + `LocalExtensionRegistry` class
- `apps/farmhand/src/local-extensions.test.ts` — unit tests
- `apps/refarm/src/commands/extension.ts` — `refarm extension new/list/save` commands

Files to modify:
- `apps/farmhand/src/index.ts` — add `loadLocalExtensions` phase (Phase 0, before bundled install) and pass `localExtRegistry` to route handler
- `apps/farmhand/src/transports/plugins.ts` — extend reload handler to include local extension IDs and route reload to `LocalExtensionRegistry`

---

## Background for implementers

### How tractor loads JS plugins (no WASM needed)
`packages/tractor-ts/src/lib/plugin-host.ts:166-247`:
```typescript
async load(manifest: PluginManifest, wasmHash?: string): Promise<PluginInstance> {
  const entryFormat = detectEntryFormat(manifest.entry); // "js" for .js URLs
  assertEntryRuntimeCompatibility(manifest.entry, "node"); // passes for .js
  // ...
  if (entryFormat !== "wasm") {
    const moduleNamespace = await this.loadJavaScriptModule(manifest.entry);
    const instance = new PluginInstanceHandle(pluginId, manifest.name, manifest, moduleNamespace, ...);
    await instance.call("setup"); // optional, fails silently
    return instance;
  }
  // ... WASM path (not reached for JS extensions)
}
```

### How tasks call plugin functions
`apps/farmhand/src/task-executor.ts:38`:
```typescript
const normalizedArgs = fn === "respond" && typeof args !== "string"
  ? JSON.stringify(args ?? {})
  : args;
const result = await instance.call(fn, normalizedArgs);
```
`instance.call("respond", argsJson)` looks in `componentInstance.integration.respond` first (via `integrationNamespaces()`), then top-level `componentInstance.respond`.

### How the reload handler works (current)
`apps/farmhand/src/transports/plugins.ts:183-252`:
- `POST /plugins/reload` body: `{ pluginIds?: string[] }`
- Default: `listInstalledPluginIds(baseDir)` (scans `~/.refarm/plugins/`)
- Per plugin: calls `loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] })`

### `installed-plugins.ts` plugin load pipeline
```typescript
await tractor.registry.register(manifest);  // register + validate
await tractor.registry.trust(manifest.id);  // mark validated
await tractor.plugins.load(manifest);        // load instance
```
Local extensions use the exact same three-step pipeline.

---

### Task 1: `LocalExtensionRegistry` + farmhand boot wiring

**Files:**
- Create: `apps/farmhand/src/local-extensions.ts`
- Create: `apps/farmhand/src/local-extensions.test.ts`
- Modify: `apps/farmhand/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/farmhand/src/local-extensions.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

vi.mock("node:fs", async () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockFs = await import("node:fs");

const makeTractor = () => ({
  registry: {
    register: vi.fn().mockResolvedValue(undefined),
    trust: vi.fn().mockResolvedValue(undefined),
  },
  plugins: {
    load: vi.fn().mockResolvedValue({}),
  },
});

describe("LocalExtensionRegistry", () => {
  const home = "/fake/home";
  const cwd = "/fake/project";
  const extDir = `${cwd}/.refarm/extensions/my-tool`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a valid project-local extension", async () => {
    vi.mocked(mockFs.existsSync).mockImplementation((p) =>
      String(p).includes(".refarm/extensions") ? true : false,
    );
    vi.mocked(mockFs.readdirSync).mockImplementation((dir, opts) => {
      if (String(dir).endsWith("extensions")) {
        return [{ name: "my-tool", isDirectory: () => true }] as ReturnType<typeof import("node:fs").readdirSync>;
      }
      return [] as ReturnType<typeof import("node:fs").readdirSync>;
    });
    vi.mocked(mockFs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith("ext.json"))
        return JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" });
      throw new Error("ENOENT");
    });

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    const tractor = makeTractor();
    const summary = await registry.load(tractor as never);

    expect(summary.loaded).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(tractor.registry.register).toHaveBeenCalledOnce();
    expect(tractor.plugins.load).toHaveBeenCalledOnce();
  });

  it("skips extension without ext.json", async () => {
    vi.mocked(mockFs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("extensions")) return true;
      if (s.endsWith("ext.json")) return false;
      return false;
    });
    vi.mocked(mockFs.readdirSync).mockReturnValue(
      [{ name: "broken", isDirectory: () => true }] as ReturnType<typeof import("node:fs").readdirSync>,
    );
    vi.mocked(mockFs.readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    const tractor = makeTractor();
    const summary = await registry.load(tractor as never);

    expect(summary.loaded).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(tractor.plugins.load).not.toHaveBeenCalled();
  });

  it("getLoadedIds returns loaded extension IDs", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readdirSync).mockImplementation((dir) => {
      if (String(dir).endsWith("extensions"))
        return [{ name: "my-tool", isDirectory: () => true }] as ReturnType<typeof import("node:fs").readdirSync>;
      return [] as ReturnType<typeof import("node:fs").readdirSync>;
    });
    vi.mocked(mockFs.readFileSync).mockReturnValue(
      JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" }),
    );

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    await registry.load(makeTractor() as never);

    expect(registry.getLoadedIds()).toContain("@local/my-tool");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @refarm.dev/farmhand run test -- local-extensions.test.ts
```

Expected: FAIL — `local-extensions.ts` does not exist.

- [ ] **Step 3: Implement `apps/farmhand/src/local-extensions.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";

interface ExtJson {
  id: string;
  name: string;
  version: string;
  capabilities?: {
    provides?: string[];
    requires?: string[];
    providesApi?: string[];
    requiresApi?: string[];
  };
}

interface PluginLoaderTarget {
  registry: {
    register(manifest: PluginManifest): Promise<string>;
    trust(pluginId: string): Promise<void>;
  };
  plugins: {
    load(manifest: PluginManifest): Promise<unknown>;
  };
}

interface LoggerLike {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

function scanExtensionDirs(baseDir: string): string[] {
  const extensionsDir = path.join(baseDir, ".refarm", "extensions");
  if (!fs.existsSync(extensionsDir)) return [];

  const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(extensionsDir, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, "ext.json")));
}

function readExtJson(extDir: string): ExtJson | null {
  try {
    const raw = fs.readFileSync(path.join(extDir, "ext.json"), "utf-8");
    const parsed = JSON.parse(raw) as ExtJson;
    if (!parsed.id || !parsed.name || !parsed.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildManifest(ext: ExtJson, extDir: string): PluginManifest {
  const entryPath = path.join(extDir, "index.js");
  return {
    id: ext.id,
    name: ext.name,
    version: ext.version,
    entry: pathToFileURL(entryPath).href,
    integrity: "",
    capabilities: {
      provides: ext.capabilities?.provides ?? [],
      requires: ext.capabilities?.requires ?? [],
      providesApi: ext.capabilities?.providesApi ?? [],
      requiresApi: ext.capabilities?.requiresApi ?? [],
    },
    permissions: [],
    targets: ["server"],
  } as unknown as PluginManifest;
}

export class LocalExtensionRegistry {
  private loadedIds: string[] = [];

  constructor(
    private cwd: string,
    private homeDir: string,
    private logger: LoggerLike = console,
  ) {}

  getLoadedIds(): string[] {
    return [...this.loadedIds];
  }

  private collectExtDirs(): string[] {
    return [
      ...scanExtensionDirs(this.cwd),
      ...scanExtensionDirs(this.homeDir),
    ];
  }

  async load(tractor: PluginLoaderTarget): Promise<{ loaded: number; skipped: number }> {
    const extDirs = this.collectExtDirs();
    let loaded = 0;
    let skipped = 0;

    for (const extDir of extDirs) {
      const ext = readExtJson(extDir);
      if (!ext) {
        skipped++;
        this.logger.warn(`[farmhand] local-ext: skipping ${extDir} (invalid ext.json)`);
        continue;
      }

      const entryPath = path.join(extDir, "index.js");
      if (!fs.existsSync(entryPath)) {
        skipped++;
        this.logger.warn(`[farmhand] local-ext: skipping ${ext.id} (index.js not found)`);
        continue;
      }

      try {
        const manifest = buildManifest(ext, extDir);
        await tractor.registry.register(manifest);
        await tractor.registry.trust(ext.id);
        await tractor.plugins.load(manifest);
        this.loadedIds = [...new Set([...this.loadedIds, ext.id])];
        loaded++;
        this.logger.info(`[farmhand] local-ext: loaded ${ext.id} (${extDir})`);
      } catch (err) {
        skipped++;
        this.logger.warn(
          `[farmhand] local-ext: failed to load ${ext.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { loaded, skipped };
  }

  async reload(tractor: PluginLoaderTarget, pluginId: string): Promise<void> {
    const extDirs = this.collectExtDirs();

    for (const extDir of extDirs) {
      const ext = readExtJson(extDir);
      if (!ext || ext.id !== pluginId) continue;

      const entryPath = path.join(extDir, "index.js");
      if (!fs.existsSync(entryPath)) {
        throw new Error(`[local-ext] index.js not found for ${pluginId}`);
      }

      const manifest = buildManifest(ext, extDir);
      await tractor.registry.register(manifest);
      await tractor.registry.trust(ext.id);
      await tractor.plugins.load(manifest);
      return;
    }

    throw new Error(`[local-ext] Extension directory not found for ${pluginId}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @refarm.dev/farmhand run test -- local-extensions.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Wire `LocalExtensionRegistry` into farmhand boot**

In `apps/farmhand/src/index.ts`, add the import at the top of the existing imports block:

```typescript
import { LocalExtensionRegistry } from "./local-extensions.js";
```

Then, after the `farmhandBaseDir` and `pluginsDir` setup (around line 316) and BEFORE the bundled install phase, insert:

```typescript
// Phase 0: Local extensions — project (.refarm/extensions/) and global (~/.refarm/extensions/)
// Loaded first so project-local extensions can override bundled plugins.
const localExtRegistry = new LocalExtensionRegistry(process.cwd(), os.homedir());
const localExtSummary = await localExtRegistry.load(
  tractor as unknown as Parameters<typeof localExtRegistry.load>[0],
);
if (localExtSummary.loaded > 0 || localExtSummary.skipped > 0) {
  console.log(
    `[farmhand] Local extensions: loaded=${localExtSummary.loaded} skipped=${localExtSummary.skipped}`,
  );
}
```

- [ ] **Step 6: Type-check**

```bash
pnpm --filter @refarm.dev/farmhand run type-check
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/farmhand/src/local-extensions.ts apps/farmhand/src/local-extensions.test.ts apps/farmhand/src/index.ts
git commit -m "feat(farmhand): LocalExtensionRegistry — load JS extensions from .refarm/extensions/ at boot"
```

---

### Task 2: Reload support for local extensions in `/reload`

**Context:** `POST /plugins/reload` currently only knows about installed WASM plugins via `listInstalledPluginIds(baseDir)`. Local extensions have IDs like `@local/my-tool`. We extend `createPluginsRouteHandler` to accept a `LocalExtensionRegistry` and include its IDs in the default reload list. Per-plugin reload routes `@local/*` IDs to `localExtRegistry.reload()` instead of `loadInstalledPlugins`.

**Files:**
- Modify: `apps/farmhand/src/transports/plugins.ts`
- Modify: `apps/farmhand/src/index.ts` (pass `localExtRegistry` to route handler)

- [ ] **Step 1: Extend `createPluginsRouteHandler` signature**

In `apps/farmhand/src/transports/plugins.ts`, add an optional fourth parameter:

```typescript
import { LocalExtensionRegistry } from "../local-extensions.js";
```

Change the function signature from:
```typescript
export function createPluginsRouteHandler(
  target: PluginLoaderTarget,
  baseDir: string,
  tracker: PluginUsageTracker,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean
```
to:
```typescript
export function createPluginsRouteHandler(
  target: PluginLoaderTarget,
  baseDir: string,
  tracker: PluginUsageTracker,
  localExtensions?: LocalExtensionRegistry,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean
```

- [ ] **Step 2: Update the `performReload` inner function**

Find the `performReload` async function inside `createPluginsRouteHandler` (it's defined inside the closure that handles deferred reloads). Replace its body with a version that routes local extension IDs:

The current `performReload` calls:
```typescript
await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
```

Change it to:
```typescript
const performReload = async (pluginId: string, watchers: Set<string>): Promise<void> => {
  try {
    if (localExtensions?.getLoadedIds().includes(pluginId)) {
      await localExtensions.reload(target as Parameters<typeof localExtensions.reload>[0], pluginId);
    } else {
      await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
    }
    status.completed.add(pluginId);
  } catch (err) {
    console.error(
      `[farmhand] Failed to reload "${pluginId}":`,
      err instanceof Error ? err.message : String(err),
    );
    status.failed.add(pluginId);
  }
  // notify all watchers
  for (const watcher of watchers) {
    const s = reloadStatuses.get(watcher);
    if (s) {
      s.pending.delete(pluginId);
      if (status.failed.has(pluginId)) s.failed.add(pluginId);
      else s.completed.add(pluginId);
    }
  }
};
```

> **Note:** Read the current `performReload` body carefully before replacing it — the watcher notification logic is already there and must be preserved exactly.

- [ ] **Step 3: Include local extension IDs in the default plugin list**

In the reload route handler (line ~196 of plugins.ts), change:
```typescript
const pluginIds =
  Array.isArray(body?.pluginIds) && ...
    ? (body.pluginIds as string[])
    : listInstalledPluginIds(baseDir);
```
to:
```typescript
const pluginIds =
  Array.isArray(body?.pluginIds) &&
  (body.pluginIds as unknown[]).every((id) => typeof id === "string")
    ? (body.pluginIds as string[])
    : [
        ...listInstalledPluginIds(baseDir),
        ...(localExtensions?.getLoadedIds() ?? []),
      ];
```

- [ ] **Step 4: Pass `localExtRegistry` from `index.ts` to the route handler**

In `apps/farmhand/src/index.ts`, find the `createPluginsRouteHandler` call and add the registry:

```typescript
const pluginsHandler = createPluginsRouteHandler(
  tractor as unknown as Parameters<typeof createPluginsRouteHandler>[0],
  farmhandBaseDir,
  usageTracker,
  localExtRegistry,  // ← add this
);
```

- [ ] **Step 5: Type-check**

```bash
pnpm --filter @refarm.dev/farmhand run type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/src/transports/plugins.ts apps/farmhand/src/index.ts
git commit -m "feat(farmhand): /reload includes local extensions — @local/* IDs reload via LocalExtensionRegistry"
```

---

### Task 3: `refarm extension new/list/save` CLI commands

**Context:** Three commands via `refarm extension`:
- `new <name> [--global]` — scaffold `.refarm/extensions/<name>/index.js` + `ext.json`
- `list` — show all extensions in project dir + global dir
- `save <name> --global` — move a project extension to `~/.refarm/extensions/`

The `name` argument becomes the directory name. The generated `id` is always `@local/<name>`.

**Files:**
- Create: `apps/refarm/src/commands/extension.ts`
- Create: `apps/refarm/src/commands/extension.test.ts`
- Modify: `apps/refarm/src/program.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/refarm/src/commands/extension.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
});

const mockFs = await import("node:fs");

describe("extension commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extensionCommand exports a Commander Command named 'extension'", async () => {
    const { extensionCommand } = await import("./extension.js");
    expect(extensionCommand.name()).toBe("extension");
  });

  it("extension new generates id as @local/<name>", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    const { buildExtJson } = await import("./extension.js");
    const ext = buildExtJson("my-tool");
    expect(ext.id).toBe("@local/my-tool");
    expect(ext.version).toBe("0.0.1");
  });

  it("extension list reads project and global dirs", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readdirSync).mockReturnValue(
      [{ name: "my-tool", isDirectory: () => true }] as ReturnType<typeof import("node:fs").readdirSync>,
    );
    vi.mocked(mockFs.readFileSync).mockReturnValue(
      JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" }),
    );

    const { listExtensions } = await import("./extension.js");
    const result = listExtensions(process.cwd(), os.homedir());
    expect(result.some((e) => e.id === "@local/my-tool")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @refarm.dev/refarm run test -- extension.test.ts
```

Expected: FAIL — `extension.ts` does not exist.

- [ ] **Step 3: Implement `apps/refarm/src/commands/extension.ts`**

```typescript
import fs from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

const INDEX_JS_TEMPLATE = (name: string, id: string) => `\
// ${id} — local refarm extension
// Loaded directly by tractor (no WASM compilation needed).
// Edit this file and run '/reload' in the refarm REPL to apply changes.

export const integration = {
  /**
   * Called by 'refarm ask <prompt>'.
   * argsJson: JSON string { prompt: string }
   * Returns: JSON string { content, model, provider, usage }
   */
  async respond(argsJson) {
    const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
    const prompt = args?.prompt ?? '';

    // TODO: replace with your extension logic
    return JSON.stringify({
      content: \`[\${${JSON.stringify(name)}}] \${prompt}\`,
      model: 'local-extension',
      provider: 'local',
      usage: { tokens_in: 0, tokens_out: 0, estimated_usd: 0 },
    });
  },
};
`;

export interface ExtJson {
  id: string;
  name: string;
  version: string;
  capabilities: { provides: string[] };
}

export function buildExtJson(name: string): ExtJson {
  return {
    id: `@local/${name}`,
    name: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    version: "0.0.1",
    capabilities: { provides: ["ai:respond"] },
  };
}

function extensionBaseDir(cwd: string, homeDir: string, isGlobal: boolean): string {
  return isGlobal
    ? path.join(homeDir, ".refarm", "extensions")
    : path.join(cwd, ".refarm", "extensions");
}

export interface ExtensionEntry {
  id: string;
  name: string;
  version: string;
  dir: string;
  scope: "project" | "global";
}

export function listExtensions(cwd: string, homeDir: string): ExtensionEntry[] {
  const results: ExtensionEntry[] = [];

  const scan = (baseDir: string, scope: "project" | "global") => {
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extDir = path.join(baseDir, entry.name);
      const extJsonPath = path.join(extDir, "ext.json");
      if (!fs.existsSync(extJsonPath)) continue;
      try {
        const ext = JSON.parse(fs.readFileSync(extJsonPath, "utf-8")) as ExtJson;
        results.push({ id: ext.id, name: ext.name, version: ext.version, dir: extDir, scope });
      } catch {
        // skip unreadable manifests
      }
    }
  };

  scan(path.join(cwd, ".refarm", "extensions"), "project");
  scan(path.join(homeDir, ".refarm", "extensions"), "global");
  return results;
}

async function newExtension(name: string, isGlobal: boolean): Promise<void> {
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const baseDir = extensionBaseDir(cwd, homeDir, isGlobal);
  const extDir = path.join(baseDir, name);

  if (fs.existsSync(extDir)) {
    console.error(`Extension '${name}' already exists at ${extDir}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(extDir, { recursive: true });

  const ext = buildExtJson(name);
  await writeFile(path.join(extDir, "ext.json"), JSON.stringify(ext, null, 2) + "\n", "utf-8");
  await writeFile(path.join(extDir, "index.js"), INDEX_JS_TEMPLATE(name, ext.id), "utf-8");

  const scope = isGlobal ? "global" : "project";
  console.log(`✓ Extension '${name}' created at ${extDir} (${scope})`);
  console.log(`  id: ${ext.id}`);
  console.log(`  Edit: ${path.join(extDir, "index.js")}`);
  console.log(`  Activate: restart farmhand, or '/reload' in the refarm REPL`);
}

async function saveExtension(name: string, toGlobal: boolean): Promise<void> {
  const cwd = process.cwd();
  const homeDir = os.homedir();

  const srcDir = toGlobal
    ? path.join(cwd, ".refarm", "extensions", name)
    : path.join(homeDir, ".refarm", "extensions", name);

  const destDir = toGlobal
    ? path.join(homeDir, ".refarm", "extensions", name)
    : path.join(cwd, ".refarm", "extensions", name);

  if (!fs.existsSync(srcDir)) {
    const fromScope = toGlobal ? "project" : "global";
    console.error(`Extension '${name}' not found in ${fromScope} scope (${srcDir})`);
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(destDir), { recursive: true });
  await rename(srcDir, destDir);

  const toScope = toGlobal ? "global" : "project";
  console.log(`✓ Extension '${name}' moved to ${toScope} scope (${destDir})`);
}

function listHandler(): void {
  const entries = listExtensions(process.cwd(), os.homedir());
  if (entries.length === 0) {
    console.log('No local extensions. Create one: refarm extension new <name>');
    return;
  }

  const idW = Math.max(...entries.map((e) => e.id.length), 2);
  const verW = Math.max(...entries.map((e) => e.version.length), 7);

  console.log(`  ${"ID".padEnd(idW)}  ${"VERSION".padEnd(verW)}  SCOPE`);
  for (const { id, version, scope } of entries) {
    console.log(`  ${id.padEnd(idW)}  ${version.padEnd(verW)}  ${scope}`);
  }
}

export const extensionCommand = new Command("extension").description(
  "Manage local JS extensions (no WASM compilation needed)",
);

extensionCommand
  .command("new <name>")
  .description("Scaffold a new local extension in .refarm/extensions/<name>/")
  .option("-g, --global", "Create in ~/.refarm/extensions/ (available in all projects)", false)
  .action(async (name: string, options: { global: boolean }) => {
    await newExtension(name, options.global);
  });

extensionCommand
  .command("list")
  .description("List local extensions in this project and globally")
  .action(listHandler);

extensionCommand
  .command("save <name>")
  .description("Move a project extension to global scope (or vice versa)")
  .option("-g, --global", "Move from project to global scope", false)
  .option("-l, --local", "Move from global to project scope", false)
  .action(async (name: string, options: { global: boolean; local: boolean }) => {
    if (!options.global && !options.local) {
      console.error("Specify --global (project→global) or --local (global→project)");
      process.exitCode = 1;
      return;
    }
    await saveExtension(name, options.global);
  });

extensionCommand
  .command("publish <name>")
  .description("Promote a local extension to a published WASM plugin package (coming soon)")
  .action((name: string) => {
    console.log(`refarm extension publish: coming soon.`);
    console.log(`To publish '${name}' now: scaffold a Rust/WIT package in packages/${name}/`);
    console.log(`  See CONTRIBUTING.md for the plugin authoring guide.`);
  });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @refarm.dev/refarm run test -- extension.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Register `extensionCommand` in `apps/refarm/src/program.ts`**

Add the import alongside other command imports:
```typescript
import { extensionCommand } from "./commands/extension.js";
```

Add the command registration after the existing `program.addCommand(pluginCommand)` line:
```typescript
program.addCommand(extensionCommand);
```

- [ ] **Step 6: Type-check**

```bash
pnpm --filter @refarm.dev/refarm run type-check
```

Expected: no errors.

- [ ] **Step 7: Smoke test — create and list an extension**

```bash
# Create a project-local extension
node --import ./scripts/farmhand-node-register-loader.mjs apps/refarm/dist/index.js extension new my-tool

# Expected output:
# ✓ Extension 'my-tool' created at <cwd>/.refarm/extensions/my-tool (project)
#   id: @local/my-tool
#   Edit: <cwd>/.refarm/extensions/my-tool/index.js

# List extensions
node --import ./scripts/farmhand-node-register-loader.mjs apps/refarm/dist/index.js extension list

# Expected: shows @local/my-tool  0.0.1  project
```

Or via the pnpm script if defined:
```bash
pnpm --filter @refarm.dev/refarm run build
node apps/refarm/dist/index.js extension new my-tool
node apps/refarm/dist/index.js extension list
```

- [ ] **Step 8: Verify generated files are correct**

```bash
cat .refarm/extensions/my-tool/ext.json
# Expected:
# {
#   "id": "@local/my-tool",
#   "name": "My Tool",
#   "version": "0.0.1",
#   "capabilities": { "provides": ["ai:respond"] }
# }

cat .refarm/extensions/my-tool/index.js
# Expected: shows the template with 'my-tool' in the echo response
```

- [ ] **Step 9: Clean up the test extension**

```bash
rm -rf .refarm/extensions/my-tool
```

- [ ] **Step 10: Commit**

```bash
git add apps/refarm/src/commands/extension.ts apps/refarm/src/commands/extension.test.ts apps/refarm/src/program.ts
git commit -m "feat(refarm): extension new/list/save — local JS extensions, zero build step"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ `refarm extension new <name>` — creates `.refarm/extensions/<name>/index.js` + `ext.json`
- ✅ `refarm extension new <name> --global` — creates in `~/.refarm/extensions/<name>/`
- ✅ farmhand loads local extensions at boot (Phase 0, before bundled/installed plugins)
- ✅ Project scope: `.refarm/extensions/`; global scope: `~/.refarm/extensions/`
- ✅ `/reload` in REPL includes `@local/*` extensions via `localExtensions.getLoadedIds()`
- ✅ `/reload` routes `@local/*` IDs to `LocalExtensionRegistry.reload()` (re-imports the JS file)
- ✅ `refarm extension list` — shows project + global extensions with scope column
- ✅ `refarm extension save <name> --global` — moves project→global
- ✅ `refarm extension save <name> --local` — moves global→project
- ✅ Template exports `integration.respond(argsJson)` — immediately works with `refarm ask`
- ✅ Tier 3 stub: `refarm extension publish <name>` prints guidance (no implementation per spec)
- ✅ No WASM compilation required — tractor's existing JS branch in `plugin-host.ts:212`
- ✅ Extensions loaded FIRST (Phase 0) so they can override bundled pi-agent

**2. Placeholder scan:** None found.

**3. Type consistency:**
- `LocalExtensionRegistry.load(tractor)` parameter type matches `installed-plugins.ts`'s `PluginLoaderTarget` pattern ✅
- `buildExtJson(name): ExtJson` — `ExtJson` exported, used in test ✅
- `listExtensions(cwd, homeDir): ExtensionEntry[]` — `ExtensionEntry` exported, used in test ✅
- `extensionCommand` exported and registered in `program.ts` ✅

**Key invariant:** `LocalExtensionRegistry.load()` must never throw — all per-extension errors are caught and counted as `skipped`. Farmhand boot must not crash if `.refarm/extensions/` does not exist (handled by `existsSync` check in `scanExtensionDirs`).

**Note for post-ship:** The `reload()` method calls `tractor.plugins.load(manifest)` again, which in tractor adds a new instance handle but may not evict the old one — `PluginHost` does not have an `unload()` API. After implementing this plan, verify that `/reload` for a local extension actually replaces the running instance (may require `PluginHost.terminate(id)` before re-loading). If it stacks instances, open a follow-up issue.
