# Farmhand Bundled Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Farmhand auto-installs pi-agent from its bundled npm package (`@refarm.dev/pi-agent`) on every boot, comparing versions to skip reinstall when already up-to-date — eliminating the manual `npm run agent:install` step and making refarm's own agent lifecycle as capable as pnpm is for managing packages.

**Architecture:** Add a `bundleInstallPlugins` phase that runs before `autoInstallPlugins` in farmhand's boot sequence. Bundled plugins are declared in a new `plugins.bundled` config field (array of `{ id, package }` entries). Farmhand resolves the npm package path via `require.resolve`, reads the WASM artifact from `dist/jco/<name>.wasm`, computes integrity, and calls `installWasmArtifact` — the same API used by `autoInstallPlugins`. A version file (`<pluginsDir>/<id>/.version`) tracks the installed version for comparison. Two new CLI commands — `refarm agent install` and `refarm agent update` — expose the same flow on demand.

**Tech Stack:** Node.js `module.createRequire`, `@refarm.dev/plugin-manifest` (`installWasmArtifact`), `@refarm.dev/config`, existing `FilesystemCacheAdapter`.

---

## File Structure

Files to create:
- `apps/farmhand/src/bundled-plugins.ts` — `bundleInstallPlugins(entries, pluginsDir, logger)` function
- `apps/farmhand/src/bundled-plugins.test.ts` — unit tests for bundled-plugins
- `apps/refarm/src/commands/agent.ts` — `refarm agent install` and `refarm agent update` commands

Files to modify:
- `apps/farmhand/src/index.ts` — add `bundleInstallPlugins` call in boot sequence (before `autoInstallPlugins`)
- `apps/farmhand/src/auto-install-plugins.ts` — export `AutoInstallEntry` type (reused by bundled-plugins)
- `apps/refarm/src/commands/` — register the `agent` command group

---

### Task 1: `bundleInstallPlugins` — core function

**Context:** The existing `autoInstallPlugins` downloads WASM from a URL. Bundled plugins read WASM from the local filesystem — specifically from the npm package that ships with the monorepo. `module.createRequire(import.meta.url)` resolves the package path even when running from a compiled dist. The integrity hash must be computed from the WASM bytes (sha512 SRI format: `sha512-<base64>`). The `.version` sentinel file prevents reinstall on every boot.

**Files:**
- Create: `apps/farmhand/src/bundled-plugins.ts`
- Create: `apps/farmhand/src/bundled-plugins.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/farmhand/src/bundled-plugins.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bundleInstallPlugin, type BundledEntry } from "./bundled-plugins.js";

// Mock installWasmArtifact so tests don't hit filesystem
vi.mock("@refarm.dev/plugin-manifest", () => ({
  installWasmArtifact: vi.fn().mockResolvedValue({ cached: false, byteLength: 1234 }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
  };
});

const mockFs = await import("node:fs");
const mockFsP = await import("node:fs/promises");
const mockPluginManifest = await import("@refarm.dev/plugin-manifest");

describe("bundleInstallPlugin", () => {
  const entry: BundledEntry = {
    id: "@refarm/pi-agent",
    package: "@refarm.dev/pi-agent",
    wasmFile: "dist/jco/_refarm_pi_agent.wasm",
  };
  const pluginsDir = "/home/user/.refarm/plugins";
  const logger = { info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs when no version file exists", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    vi.mocked(mockFs.readFileSync).mockReturnValue(Buffer.from("fake-wasm-bytes"));
    vi.mocked(mockFsP.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await bundleInstallPlugin(entry, pluginsDir, logger, "0.1.0");

    expect(result.status).toBe("installed");
    expect(mockPluginManifest.installWasmArtifact).toHaveBeenCalled();
  });

  it("skips when installed version matches package version", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFsP.readFile).mockResolvedValue("0.1.0");

    const result = await bundleInstallPlugin(entry, pluginsDir, logger, "0.1.0");

    expect(result.status).toBe("cached");
    expect(mockPluginManifest.installWasmArtifact).not.toHaveBeenCalled();
  });

  it("reinstalls when installed version differs", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFsP.readFile).mockResolvedValue("0.0.9");
    vi.mocked(mockFs.readFileSync).mockReturnValue(Buffer.from("fake-wasm-bytes"));

    const result = await bundleInstallPlugin(entry, pluginsDir, logger, "0.1.0");

    expect(result.status).toBe("installed");
    expect(mockPluginManifest.installWasmArtifact).toHaveBeenCalled();
  });

  it("returns failed when wasm file not found in package", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    vi.mocked(mockFsP.readFile).mockRejectedValue(new Error("ENOENT"));
    // Simulate require.resolve throwing (package not installed)
    // bundleInstallPlugin should catch and return failed
    vi.mocked(mockFs.readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });

    const result = await bundleInstallPlugin(entry, pluginsDir, logger, "0.1.0");

    expect(result.status).toBe("failed");
    expect(logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix apps/farmhand run test -- bundled-plugins.test.ts
```

Expected: FAIL — `bundled-plugins.ts` does not exist.

- [ ] **Step 3: Implement `apps/farmhand/src/bundled-plugins.ts`**

```typescript
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { installWasmArtifact } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";

export interface BundledEntry {
  id: string;
  package: string;
  wasmFile: string;
}

export interface BundledResult {
  status: "installed" | "cached" | "failed";
  id: string;
}

export interface BundledSummary {
  installed: number;
  cached: number;
  failed: number;
}

interface LoggerLike {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

function computeSri(bytes: Buffer): string {
  return "sha512-" + createHash("sha512").update(bytes).digest("base64");
}

function resolvePackagePath(packageName: string, wasmFile: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(pkgJsonPath), wasmFile);
  } catch {
    return null;
  }
}

function readPackageVersion(packageName: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve(`${packageName}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function versionFilePath(pluginsDir: string, id: string): string {
  return path.join(pluginsDir, id.replace(/\//g, "_").replace(/@/g, ""), ".version");
}

async function readInstalledVersion(pluginsDir: string, id: string): Promise<string | null> {
  try {
    return (await readFile(versionFilePath(pluginsDir, id), "utf-8")).trim();
  } catch {
    return null;
  }
}

async function writeInstalledVersion(pluginsDir: string, id: string, version: string): Promise<void> {
  const filePath = versionFilePath(pluginsDir, id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, version, "utf-8");
}

export async function bundleInstallPlugin(
  entry: BundledEntry,
  pluginsDir: string,
  logger: LoggerLike,
  packageVersion?: string,
): Promise<BundledResult> {
  const pkgVersion = packageVersion ?? readPackageVersion(entry.package);
  if (!pkgVersion) {
    logger.warn(`[farmhand] bundled: ${entry.id}: cannot read package version from ${entry.package}`);
    return { status: "failed", id: entry.id };
  }

  const installedVersion = await readInstalledVersion(pluginsDir, entry.id);
  if (installedVersion === pkgVersion) {
    logger.info(`[farmhand] bundled: ${entry.id} v${pkgVersion} already installed`);
    return { status: "cached", id: entry.id };
  }

  const wasmPath = resolvePackagePath(entry.package, entry.wasmFile);
  if (!wasmPath || !existsSync(wasmPath)) {
    logger.warn(`[farmhand] bundled: ${entry.id}: WASM artifact not found at ${wasmPath ?? entry.wasmFile}`);
    return { status: "failed", id: entry.id };
  }

  try {
    const wasmBytes = readFileSync(wasmPath);
    const integrity = computeSri(wasmBytes);
    const wasmUrl = `file://${wasmPath}`;
    const cache = createFilesystemCacheAdapter(pluginsDir);

    const result = await installWasmArtifact(
      { pluginId: entry.id, wasmUrl, integrity },
      { cache },
    );

    await writeInstalledVersion(pluginsDir, entry.id, pkgVersion);

    logger.info(
      `[farmhand] bundled: ${entry.id} v${pkgVersion} ${result.cached ? "cache-hit" : `installed (${result.byteLength} bytes)`}`,
    );
    return { status: "installed", id: entry.id };
  } catch (err) {
    logger.warn(
      `[farmhand] bundled: ${entry.id}: install failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return { status: "failed", id: entry.id };
  }
}

export async function bundleInstallPlugins(
  entries: BundledEntry[],
  pluginsDir: string,
  logger: LoggerLike = console,
): Promise<BundledSummary> {
  const summary: BundledSummary = { installed: 0, cached: 0, failed: 0 };
  for (const entry of entries) {
    const result = await bundleInstallPlugin(entry, pluginsDir, logger);
    summary[result.status] += 1;
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --prefix apps/farmhand run test -- bundled-plugins.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/farmhand/src/bundled-plugins.ts apps/farmhand/src/bundled-plugins.test.ts
git commit -m "feat(farmhand): bundleInstallPlugin — WASM from npm package with version guard"
```

---

### Task 2: Wire `bundleInstallPlugins` into farmhand boot

**Context:** Farmhand's boot sequence in `index.ts` currently runs: Tractor.boot → `autoInstallPlugins` (URL-based) → `loadInstalledPlugins` (filesystem scan). The new bundled phase must run first — before URL-based auto-install — so that pi-agent is available before any plugins that might depend on it. The pi-agent bundled config is hardcoded as a default (not requiring any user config), following the pattern that refarm manages its own agent lifecycle natively.

**Files:**
- Modify: `apps/farmhand/src/index.ts`

- [ ] **Step 1: Import `bundleInstallPlugins` and `BundledEntry` in `index.ts`**

```typescript
import { bundleInstallPlugins, type BundledEntry } from "./bundled-plugins.js";
```

- [ ] **Step 2: Add the bundled install phase before `autoInstallPlugins`**

Find the block starting at ~line 304 (`const farmhandBaseDir = ...`) and insert after `const pluginsDir`:

```typescript
const pluginsDir = path.join(farmhandBaseDir, "plugins");

// Bundled plugins: auto-install from co-located npm packages (no user config required)
const defaultBundled: BundledEntry[] = [
  {
    id: "@refarm/pi-agent",
    package: "@refarm.dev/pi-agent",
    wasmFile: "dist/jco/_refarm_pi_agent.wasm",
  },
];
const configBundled: BundledEntry[] = Array.isArray(config?.plugins?.bundled)
  ? (config.plugins.bundled as BundledEntry[])
  : [];
const bundledEntries = [...defaultBundled, ...configBundled];

const bundledSummary = await bundleInstallPlugins(bundledEntries, pluginsDir);
console.log(
  `[farmhand] Bundled install: installed=${bundledSummary.installed} cached=${bundledSummary.cached} failed=${bundledSummary.failed}`,
);
```

- [ ] **Step 3: Ensure `pluginsDir` is declared once**

The existing code declares `pluginsDir` inside an `if (autoEntries.length > 0)` block. Move it out so both bundled and auto-install phases can use it:

```typescript
const pluginsDir = path.join(farmhandBaseDir, "plugins");
await mkdir(pluginsDir, { recursive: true });
```

Remove the inner `const pluginsDir` declaration from the `if (autoEntries.length > 0)` block.

- [ ] **Step 4: Type-check**

```bash
npm --prefix apps/farmhand run type-check
```

Expected: no errors.

- [ ] **Step 5: Smoke test (farmhand boots without error)**

```bash
npm --prefix apps/farmhand run start -- --dry-run 2>&1 | head -20
```

If `--dry-run` is not supported, just run and Ctrl+C after seeing the bundled install log line.

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/src/index.ts
git commit -m "feat(farmhand): wire bundleInstallPlugins into boot — pi-agent auto-installs from npm package"
```

---

### Task 3: Add `refarm agent install` and `refarm agent update` commands

**Context:** The `refarm` CLI (in `apps/refarm`) needs two commands: `refarm agent install` — force-installs all bundled plugins (bypasses version check); `refarm agent update` — checks for newer version in npm package vs installed, installs if newer. These are the "refarm manages its own agent" commands that mirror what `pnpm install` does for packages. They share the same `bundleInstallPlugin` logic from farmhand.

**Files:**
- Create: `apps/refarm/src/commands/agent.ts`
- Modify: `apps/refarm/src/commands/` — register agent command

- [ ] **Step 1: Write the failing test for agent commands**

Create `apps/refarm/src/commands/agent.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Minimal smoke test — CLI command registration
vi.mock("@refarm.dev/farmhand/bundled-plugins", () => ({
  bundleInstallPlugin: vi.fn().mockResolvedValue({ status: "installed", id: "@refarm/pi-agent" }),
}));

describe("refarm agent command", () => {
  it("agent module exports install and update handlers", async () => {
    const { agentInstallHandler, agentUpdateHandler } = await import("./agent.js");
    expect(typeof agentInstallHandler).toBe("function");
    expect(typeof agentUpdateHandler).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix apps/refarm run test -- agent.test.ts
```

Expected: FAIL — `agent.ts` does not exist.

- [ ] **Step 3: Implement `apps/refarm/src/commands/agent.ts`**

```typescript
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { bundleInstallPlugin, type BundledEntry } from "@refarm.dev/farmhand/bundled-plugins";

const DEFAULT_BUNDLED: BundledEntry[] = [
  {
    id: "@refarm/pi-agent",
    package: "@refarm.dev/pi-agent",
    wasmFile: "dist/jco/_refarm_pi_agent.wasm",
  },
];

const pluginsDir = path.join(os.homedir(), ".refarm", "plugins");

async function resolvePackageVersion(packageName: string): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require(`${packageName}/package.json`) as { version?: string };
    return pkgJson.version ?? null;
  } catch {
    return null;
  }
}

export async function agentInstallHandler(): Promise<void> {
  console.log("[refarm agent install] Installing bundled plugins...");
  for (const entry of DEFAULT_BUNDLED) {
    // Force install by passing a mismatched sentinel version
    const result = await bundleInstallPlugin(entry, pluginsDir, console, "__force__");
    console.log(`  ${entry.id}: ${result.status}`);
  }
}

export async function agentUpdateHandler(): Promise<void> {
  console.log("[refarm agent update] Checking for updates...");
  for (const entry of DEFAULT_BUNDLED) {
    const pkgVersion = await resolvePackageVersion(entry.package);
    if (!pkgVersion) {
      console.warn(`  ${entry.id}: cannot resolve package version`);
      continue;
    }
    const result = await bundleInstallPlugin(entry, pluginsDir, console, pkgVersion);
    if (result.status === "cached") {
      console.log(`  ${entry.id}: already up-to-date (v${pkgVersion})`);
    } else {
      console.log(`  ${entry.id}: ${result.status} → v${pkgVersion}`);
    }
  }
}
```

> **Note:** `@refarm.dev/farmhand/bundled-plugins` requires an export condition in `apps/farmhand/package.json`. Add: `"./bundled-plugins": { "types": "./dist/bundled-plugins.d.ts", "import": "./dist/bundled-plugins.js" }`.

- [ ] **Step 4: Add `bundled-plugins` export to farmhand's `package.json`**

In `apps/farmhand/package.json`, add under `"exports"`:
```json
"./bundled-plugins": {
  "types": "./dist/bundled-plugins.d.ts",
  "import": "./dist/bundled-plugins.js"
}
```

- [ ] **Step 5: Register `agent` command in the refarm CLI**

Find where other commands are registered (e.g., `apps/refarm/src/commands/index.ts` or the main CLI entry). Add:

```typescript
import { agentInstallHandler, agentUpdateHandler } from "./agent.js";

// In the command registration block:
program
  .command("agent")
  .description("Manage refarm agent plugins")
  .addCommand(
    new Command("install")
      .description("Force-install all bundled agent plugins")
      .action(agentInstallHandler)
  )
  .addCommand(
    new Command("update")
      .description("Update bundled agent plugins to the npm package version")
      .action(agentUpdateHandler)
  );
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm --prefix apps/refarm run test -- agent.test.ts
```

Expected: 1 passing.

- [ ] **Step 7: Type-check**

```bash
npm --prefix apps/refarm run type-check
```

Expected: no errors.

- [ ] **Step 8: Smoke test — run the commands**

```bash
npm --prefix apps/refarm run start -- agent install
npm --prefix apps/refarm run start -- agent update
```

Expected: both print install/update status for `@refarm/pi-agent`.

- [ ] **Step 9: Commit**

```bash
git add apps/refarm/src/commands/agent.ts apps/refarm/src/commands/agent.test.ts apps/farmhand/package.json
git commit -m "feat(refarm): agent install + agent update commands — native agent lifecycle management"
```

---

### Task 4: Remove `npm run agent:install` from manual onboarding docs

**Context:** The reason `npm run agent:install` exists is that pi-agent's WASM `entry` and `integrity` fields in `plugin.json` are injected at install time by `scripts/pi-agent-install.mjs`. With the new bundled approach, farmhand computes integrity from the WASM bytes at runtime — so the manual step is no longer needed on fresh installs. The install script stays for backward compatibility but is no longer the primary path.

**Files:**
- Modify: `packages/pi-agent/plugin.json` — add note clarifying it's now auto-installed
- Modify: Any `CONTRIBUTING.md`, `README.md`, or docs referencing `npm run agent:install`

- [ ] **Step 1: Find all references to `agent:install`**

```bash
grep -rn "agent:install\|agent-install\|pi-agent-install" --include="*.md" --include="*.ts" --include="*.mjs" .
```

- [ ] **Step 2: Update `plugin.json` note**

```json
{
  "_note": "Template only — bundled install via farmhand reads WASM from dist/jco/ at runtime. Legacy: entry and integrity can also be injected by scripts/pi-agent-install.mjs",
  ...
}
```

- [ ] **Step 3: Update any documentation that says to run `npm run agent:install`**

Replace instructions with: "Farmhand auto-installs pi-agent on first boot. To manually trigger: `refarm agent install`."

- [ ] **Step 4: Verify farmhand actually installs pi-agent on boot without manual step**

```bash
# Remove any existing pi-agent install
rm -rf ~/.refarm/plugins/@refarm_pi-agent 2>/dev/null || true

# Start farmhand
npm --prefix apps/farmhand run start &
FARMHAND_PID=$!
sleep 3

# Check if pi-agent was installed
ls ~/.refarm/plugins/ 2>/dev/null && echo "pi-agent installed" || echo "NOT installed"
kill $FARMHAND_PID 2>/dev/null || true
```

Expected: `pi-agent installed`.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-agent/plugin.json docs/ README.md CONTRIBUTING.md 2>/dev/null || git add packages/pi-agent/plugin.json
git commit -m "docs(pi-agent): farmhand now auto-installs — refarm agent install replaces manual script"
```

---

## Self-Review

**Spec coverage:**
- ✅ `bundleInstallPlugins` reads WASM from npm package (no URL, no manual script)
- ✅ Version comparison prevents reinstall on every boot
- ✅ `plugins.bundled` config field for user-declared bundled plugins
- ✅ Hardcoded default for pi-agent (no user config needed)
- ✅ `refarm agent install` — force install
- ✅ `refarm agent update` — version-aware update
- ✅ SRI integrity computed from actual WASM bytes (not hardcoded)
- ✅ Fallback: if pi-agent dist not built, logs warning and continues (no crash)
- ✅ Manual `npm run agent:install` docs updated

**Key invariant:** `bundleInstallPlugin` must never throw — it catches all errors and returns `{ status: "failed" }`. Farmhand boot must not crash if pi-agent dist is absent (e.g., in CI before pi-agent is built).
