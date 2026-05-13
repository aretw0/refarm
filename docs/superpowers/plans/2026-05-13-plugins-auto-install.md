# Plugins Auto-Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `plugins.autoInstall` from `refarm.config.json` into farmhand's startup sequence so declared plugins have their WASM binaries cached on boot — idempotent, cache-first, no extra files.

**Architecture:** A new `autoInstallPlugins(entries, pluginsDir)` function iterates config entries, calling `installWasmArtifact` (which uses `FilesystemCacheAdapter` and is already cache-first). This runs before `loadInstalledPlugins` so the binaries exist on disk when the manifest scan runs. The config entry shape is `{ id, url, integrity }` — no manifest embedded. The on-disk `plugin.json` (written by a prior `POST /plugins/install`) is what `loadInstalledPlugins` uses.

**Tech Stack:** `@refarm.dev/config` (`loadConfigAsync`), `@refarm.dev/plugin-manifest` (`installWasmArtifact`), `FilesystemCacheAdapter` (Task 1 of the Barn plan), Vitest.

---

## Context for agentic workers

**Key prior work (already merged on `develop`):**
- `apps/farmhand/src/filesystem-cache-adapter.ts` — `createFilesystemCacheAdapter(pluginsDir): PluginBinaryCacheAdapter`
- `apps/farmhand/src/transports/plugins.ts` — `POST /plugins/install` (uses the same adapter + `installWasmArtifact`)
- `apps/farmhand/src/installed-plugins.ts` — `loadInstalledPlugins` scans `<baseDir>/plugins/*/plugin.json`
- `packages/config/src/index.js` — `loadConfigAsync(root?)` returns parsed `refarm.config.json` (deep-merged with env)
- `refarm.config.json` — project-level config already has `providers`, `brand`, `mode`, `storage`

**`installWasmArtifact` contract (from `@refarm.dev/plugin-manifest`):**
```typescript
installWasmArtifact(
  req: { pluginId: string; wasmUrl: string; integrity: string },
  opts: { cache: PluginBinaryCacheAdapter }
): Promise<{ pluginId, wasmUrl, cached: boolean, byteLength, wasmHash, artifactKind }>
```
`cached: true` means the binary was already on disk — no download happened.

**`loadConfigAsync` behavior:** reads `refarm.config.json` walking up from `process.cwd()`. Returns `{}` if not found. Returns `any` — no TypeScript schema enforcement.

**Startup sequence in `apps/farmhand/src/index.ts` (current order):**
1. `injectSiloModelEnv()`
2. Boot Tractor
3. `mkdir(farmhandBaseDir)` — ensures `~/.refarm/` exists
4. `loadInstalledPlugins(tractor, farmhandBaseDir)` ← insert auto-install BEFORE this

**Design invariant:** `autoInstallPlugins` does NOT write `plugin.json`. It only warms the WASM cache. `loadInstalledPlugins` loads whatever `plugin.json` files already exist on disk. A plugin declared in `autoInstall` but without a `plugin.json` on disk will have its binary cached but will not be loaded — that is correct behavior. The `POST /plugins/install` (or future `refarm plugins install` CLI) is what creates `plugin.json`.

---

## File Map

| File | Change |
|---|---|
| `apps/farmhand/src/auto-install-plugins.ts` | **Create** — `autoInstallPlugins(entries, pluginsDir, logger?)` |
| `apps/farmhand/src/auto-install-plugins.test.ts` | **Create** — unit tests (mocked `installWasmArtifact`) |
| `apps/farmhand/src/index.ts` | **Modify** — call `autoInstallPlugins` before `loadInstalledPlugins` |
| `apps/farmhand/package.json` | **Modify** — add `"@refarm.dev/config": "*"` to dependencies |
| `refarm.config.json` | **Modify** — add `"plugins": { "autoInstall": [] }` section |

---

## Task 1: autoInstallPlugins function

**Files:**
- Create: `apps/farmhand/src/auto-install-plugins.ts`
- Create: `apps/farmhand/src/auto-install-plugins.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/farmhand/src/auto-install-plugins.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@refarm.dev/plugin-manifest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@refarm.dev/plugin-manifest")>();
	return {
		...actual,
		installWasmArtifact: vi.fn().mockResolvedValue({
			pluginId: "plugin-a",
			wasmUrl: "https://example.com/plugin-a.wasm",
			cached: false,
			byteLength: 1024,
			wasmHash: "sha256-abc123",
			artifactKind: "component",
		}),
	};
});

vi.mock("./filesystem-cache-adapter.js", () => ({
	createFilesystemCacheAdapter: vi.fn().mockReturnValue({
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
		evict: vi.fn().mockResolvedValue(undefined),
	}),
}));

import { installWasmArtifact } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";
import { autoInstallPlugins } from "./auto-install-plugins.js";

describe("autoInstallPlugins", () => {
	const pluginsDir = "/fake/plugins";
	const logger = { info: vi.fn(), warn: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns zero summary for empty entries", async () => {
		const summary = await autoInstallPlugins([], pluginsDir, logger);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 0 });
		expect(installWasmArtifact).not.toHaveBeenCalled();
	});

	it("calls installWasmArtifact with correct pluginId, wasmUrl, integrity", async () => {
		const entries = [
			{ id: "plugin-a", url: "https://example.com/plugin-a.wasm", integrity: "sha256-abc" },
		];
		await autoInstallPlugins(entries, pluginsDir, logger);
		expect(installWasmArtifact).toHaveBeenCalledWith(
			{ pluginId: "plugin-a", wasmUrl: "https://example.com/plugin-a.wasm", integrity: "sha256-abc" },
			expect.objectContaining({ cache: expect.anything() }),
		);
	});

	it("creates the cache adapter with pluginsDir", async () => {
		await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(createFilesystemCacheAdapter).toHaveBeenCalledWith(pluginsDir);
	});

	it("counts installed when result.cached is false", async () => {
		vi.mocked(installWasmArtifact).mockResolvedValueOnce({
			pluginId: "a",
			wasmUrl: "u",
			cached: false,
			byteLength: 512,
			wasmHash: "h",
			artifactKind: "component",
		});
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 1, cached: 0, failed: 0 });
	});

	it("counts cached when result.cached is true", async () => {
		vi.mocked(installWasmArtifact).mockResolvedValueOnce({
			pluginId: "a",
			wasmUrl: "u",
			cached: true,
			byteLength: 512,
			wasmHash: "h",
			artifactKind: "component",
		});
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 0, cached: 1, failed: 0 });
	});

	it("skips and counts failed for entries missing required fields", async () => {
		const entries = [
			{ url: "u", integrity: "i" },          // missing id
			{ id: "b", integrity: "i" },            // missing url
			{ id: "c", url: "u" },                  // missing integrity
			null,                                   // not an object
		];
		const summary = await autoInstallPlugins(entries, pluginsDir, logger);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 4 });
		expect(installWasmArtifact).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledTimes(4);
	});

	it("counts failed and warns when installWasmArtifact throws", async () => {
		vi.mocked(installWasmArtifact).mockRejectedValueOnce(
			new Error("integrity check failed"),
		);
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "bad" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 1 });
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("failed to install a"),
			"integrity check failed",
		);
	});

	it("processes multiple entries accumulating counts", async () => {
		vi.mocked(installWasmArtifact)
			.mockResolvedValueOnce({ pluginId: "a", wasmUrl: "ua", cached: false, byteLength: 100, wasmHash: "h1", artifactKind: "component" })
			.mockResolvedValueOnce({ pluginId: "b", wasmUrl: "ub", cached: true,  byteLength: 200, wasmHash: "h2", artifactKind: "component" })
			.mockRejectedValueOnce(new Error("network error"));
		const entries = [
			{ id: "a", url: "ua", integrity: "ia" },
			{ id: "b", url: "ub", integrity: "ib" },
			{ id: "c", url: "uc", integrity: "ic" },
		];
		const summary = await autoInstallPlugins(entries, pluginsDir, logger);
		expect(summary).toEqual({ installed: 1, cached: 1, failed: 1 });
	});
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /workspaces/refarm/apps/farmhand && npx vitest run --reporter verbose auto-install-plugins 2>&1 | tail -10
```

Expected: fail with `Cannot find module './auto-install-plugins.js'`.

- [ ] **Step 3: Implement autoInstallPlugins**

Create `apps/farmhand/src/auto-install-plugins.ts`:

```typescript
import { installWasmArtifact } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";

export interface AutoInstallEntry {
	id: string;
	url: string;
	integrity: string;
}

export interface AutoInstallSummary {
	installed: number;
	cached: number;
	failed: number;
}

interface LoggerLike {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

function isValidEntry(entry: unknown): entry is AutoInstallEntry {
	if (!entry || typeof entry !== "object") return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e["id"] === "string" &&
		typeof e["url"] === "string" &&
		typeof e["integrity"] === "string"
	);
}

export async function autoInstallPlugins(
	entries: unknown[],
	pluginsDir: string,
	logger: LoggerLike = console,
): Promise<AutoInstallSummary> {
	const summary: AutoInstallSummary = { installed: 0, cached: 0, failed: 0 };
	const cache = createFilesystemCacheAdapter(pluginsDir);

	for (const raw of entries) {
		if (!isValidEntry(raw)) {
			logger.warn("[farmhand] autoInstall: skipping invalid entry", raw);
			summary.failed += 1;
			continue;
		}

		try {
			const result = await installWasmArtifact(
				{ pluginId: raw.id, wasmUrl: raw.url, integrity: raw.integrity },
				{ cache },
			);

			if (result.cached) {
				logger.info(`[farmhand] autoInstall: ${raw.id} already cached`);
				summary.cached += 1;
			} else {
				logger.info(`[farmhand] autoInstall: ${raw.id} installed (${result.byteLength} bytes)`);
				summary.installed += 1;
			}
		} catch (err) {
			logger.warn(
				`[farmhand] autoInstall: failed to install ${raw.id}:`,
				err instanceof Error ? err.message : String(err),
			);
			summary.failed += 1;
		}
	}

	return summary;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /workspaces/refarm/apps/farmhand && npx vitest run --reporter verbose auto-install-plugins 2>&1 | tail -15
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run full farmhand suite**

```bash
cd /workspaces/refarm/apps/farmhand && npx vitest run 2>&1 | tail -8
```

Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/refarm && git add apps/farmhand/src/auto-install-plugins.ts apps/farmhand/src/auto-install-plugins.test.ts
git commit -m "feat(farmhand): autoInstallPlugins — warm WASM cache from config.plugins.autoInstall"
```

---

## Task 2: Wire into farmhand startup

**Files:**
- Modify: `apps/farmhand/package.json`
- Modify: `apps/farmhand/src/index.ts`
- Modify: `refarm.config.json`

- [ ] **Step 1: Add `@refarm.dev/config` to farmhand dependencies**

In `apps/farmhand/package.json`, add `"@refarm.dev/config": "*"` to the `dependencies` object (alphabetically between `@refarm.dev/barn` area and `@refarm.dev/effort-contract-v1`):

```json
"dependencies": {
  "@refarm.dev/config": "*",
  "@refarm.dev/effort-contract-v1": "*",
  ...
}
```

Then install:

```bash
cd /workspaces/refarm && npm install 2>&1 | tail -5
```

Expected: installs without error, `@refarm.dev/config` appears in farmhand's `node_modules`.

- [ ] **Step 2: Add import to `index.ts`**

At the top of `apps/farmhand/src/index.ts`, add these two imports alongside the existing ones:

```typescript
import { loadConfigAsync } from "@refarm.dev/config";
import { autoInstallPlugins } from "./auto-install-plugins.js";
```

- [ ] **Step 3: Call autoInstallPlugins in main()**

In `apps/farmhand/src/index.ts`, find this block (around line 211–221):

```typescript
	const farmhandBaseDir = path.join(os.homedir(), ".refarm");
	await mkdir(farmhandBaseDir, { recursive: true });
	const loadSummary = await loadInstalledPlugins(
		tractor as unknown as Parameters<typeof loadInstalledPlugins>[0],
		farmhandBaseDir,
	);
```

Replace it with:

```typescript
	const farmhandBaseDir = path.join(os.homedir(), ".refarm");
	await mkdir(farmhandBaseDir, { recursive: true });

	const config = await loadConfigAsync().catch(() => ({}));
	const autoEntries: unknown[] = Array.isArray(config?.plugins?.autoInstall)
		? (config.plugins.autoInstall as unknown[])
		: [];
	if (autoEntries.length > 0) {
		const pluginsDir = path.join(farmhandBaseDir, "plugins");
		const autoSummary = await autoInstallPlugins(autoEntries, pluginsDir);
		console.log(
			`[farmhand] Auto-install: installed=${autoSummary.installed} cached=${autoSummary.cached} failed=${autoSummary.failed}`,
		);
	}

	const loadSummary = await loadInstalledPlugins(
		tractor as unknown as Parameters<typeof loadInstalledPlugins>[0],
		farmhandBaseDir,
	);
```

- [ ] **Step 4: Add plugins section to refarm.config.json**

Read the current `refarm.config.json` and add `"plugins"` as a top-level key:

```json
{
  "providers": { ... },
  "brand": { ... },
  "mode": "persistent",
  "storage": "opfs",
  "plugins": {
    "autoInstall": []
  }
}
```

The `autoInstall` array is empty — no plugins are declared by default. Adding a plugin here looks like:
```json
"autoInstall": [
  {
    "id": "@refarm/pi-agent",
    "url": "https://registry.refarm.dev/@refarm/pi-agent/0.3.0/pi-agent.wasm",
    "integrity": "sha256-<hash>"
  }
]
```

- [ ] **Step 5: TypeScript check**

```bash
cd /workspaces/refarm/apps/farmhand && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If `config?.plugins?.autoInstall` causes a TS error because `loadConfigAsync` returns `any`, the `Array.isArray` guard is sufficient — `any` is assignable everywhere.

- [ ] **Step 6: Run full farmhand suite**

```bash
cd /workspaces/refarm/apps/farmhand && npx vitest run 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/refarm && git add apps/farmhand/src/index.ts apps/farmhand/package.json refarm.config.json
git commit -m "feat(farmhand): wire plugins.autoInstall from refarm.config.json into startup sequence"
```

---

## Final verification

- [ ] **Confirm the startup sequence is correct**

```bash
grep -n "autoInstall\|loadInstalledPlugins\|autoInstallPlugins" /workspaces/refarm/apps/farmhand/src/index.ts
```

Expected: `autoInstallPlugins` call appears BEFORE `loadInstalledPlugins` call.

- [ ] **Confirm config schema**

```bash
grep -A5 '"plugins"' /workspaces/refarm/refarm.config.json
```

Expected: `"autoInstall": []` present.

- [ ] **Run full suite one last time**

```bash
cd /workspaces/refarm/apps/farmhand && npx vitest run 2>&1 | tail -5
```

Expected: all pass.
