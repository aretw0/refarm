# The Cockpit: `refarm context` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Refarm able to say which sovereign state is active, and prove it by the one fact that cannot be faked — the hash of the artifact the running process actually loaded.

**Architecture:** Read what the process WAS STARTED WITH rather than reconstructing where it ought to look. A resolver reads the running node's own `--plugin` argument and hashes it; `refarm context` reports the resolved state; the existing freshness check stops watching an abandoned path and starts watching the loaded one.

**Tech Stack:** TypeScript (`apps/refarm`, vitest). No Rust, no WASM rebuild.

**Spec:** `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` (D1, D2)

**This is plan 1 of 2.** Plan 2 builds the isolated launcher and parity (spec D3, D4). It is sequenced second because without this cockpit, "the sandbox works" could only be asserted, not shown — and the defect this plan fixes is precisely an instrument that asserted.

## Global Constraints

- **Never reconstruct a path where the real one can be read.** The root cause being fixed is `defaultAgentPluginPath` (`apps/refarm/src/utils/runtime-freshness.ts:252-255`) returning `plugins/@refarm/agent/plugin.wasm` while the daemon loads `plugins/refarm_agent/plugin.wasm`. A corrected guess would drift again at the next installer change; the process's own argv will not.
- **A path is not proof.** Every claim about "the loaded artifact" carries its SHA-256. Measured 2026-08-05: `~/.refarm/plugins/refarm_agent/plugin.wasm` is 477,924 bytes and loaded; `~/.refarm/plugins/@refarm/agent/plugin.wasm` is 476,441 bytes and watched. Same directory tree, same day, different bytes.
- **Three states, never two.** `fresh | stale | unknown`, and `unknown` is REPORTED, never rounded down to fine. This is the existing posture of `resolveRuntimeFreshness` and it must not be weakened.
- **Never restart, never write.** `refarm context` reads and reports. Restarting a node interrupts what it is serving and is the operator's call — the same rule `runtime-freshness-doctor.ts` already states in its own header.
- **Pure core, impure edge.** Filesystem and process reads happen in the caller; the resolvers and finding builders are pure and driven by literals in tests. This is the established shape across every doctor finding in this codebase.
- `apps/refarm` is TypeScript with `.js` import specifiers in relative imports.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/refarm/src/utils/loaded-plugin.ts` | **New.** Read a running node's actual `--plugin` argument and hash it. | 1 |
| `apps/refarm/src/utils/loaded-plugin.test.ts` | **New.** argv parsing and hashing, driven by literals. | 1 |
| `apps/refarm/src/utils/runtime-freshness.ts:252-255` | Stop watching an abandoned path. | 2 |
| `apps/refarm/src/commands/context.ts` | **New.** The resolved-context report, pure over inputs. | 3 |
| `apps/refarm/src/commands/context.test.ts` | **New.** Report shape and divergence cases. | 3 |
| `apps/refarm/src/commands/sovereign-divergence-doctor.ts` | **New.** The doctor finding for a state nothing loads. | 4 |
| `apps/refarm/src/commands/sovereign-divergence-doctor.test.ts` | **New.** Finding text and silence conditions. | 4 |
| the CLI's command registry | Register `context`. | 3 |

---

### Task 1: Read what the process actually loaded

**Files:**
- Create: `apps/refarm/src/utils/loaded-plugin.ts`
- Test: `apps/refarm/src/utils/loaded-plugin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface LoadedPlugin { path: string; sha256: string | null; unreadableReason?: string }`
  - `export function parsePluginArgFromCommandLine(commandLine: string[]): string | undefined`
  - `export function resolveLoadedPlugin(pid: number, deps?: LoadedPluginDeps): LoadedPlugin | null`
  - `export interface LoadedPluginDeps { readCommandLine?(pid: number): string[] | null; hashFile?(path: string): string | null }`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parsePluginArgFromCommandLine, resolveLoadedPlugin } from "./loaded-plugin.js";

describe("parsePluginArgFromCommandLine", () => {
	it("reads the separated form the daemon is actually started with", () => {
		expect(
			parsePluginArgFromCommandLine(["/path/tractor", "--plugin", "/home/op/.refarm/plugins/refarm_agent/plugin.wasm"]),
		).toBe("/home/op/.refarm/plugins/refarm_agent/plugin.wasm");
	});

	it("reads the equals form", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin=/a/b.wasm"])).toBe("/a/b.wasm");
	});

	it("returns undefined when no plugin was named — absent means absent", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--port", "7777"])).toBeUndefined();
	});

	it("returns undefined for a dangling flag rather than swallowing the next argument", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin"])).toBeUndefined();
	});

	it("takes the FIRST occurrence, matching how the host reads its own argv", () => {
		expect(parsePluginArgFromCommandLine(["t", "--plugin", "/first.wasm", "--plugin", "/second.wasm"])).toBe("/first.wasm");
	});
});

describe("resolveLoadedPlugin", () => {
	const deps = {
		readCommandLine: () => ["/t", "--plugin", "/loaded.wasm"],
		hashFile: () => "abc123",
	};

	it("reports the loaded path with its hash", () => {
		expect(resolveLoadedPlugin(42, deps)).toEqual({ path: "/loaded.wasm", sha256: "abc123" });
	});

	it("reports the path with a REASON when the file cannot be hashed — never a silent null", () => {
		const result = resolveLoadedPlugin(42, { ...deps, hashFile: () => null });
		expect(result?.path).toBe("/loaded.wasm");
		expect(result?.sha256).toBeNull();
		expect(result?.unreadableReason).toBeTruthy();
	});

	it("returns null when the process cannot be read at all", () => {
		expect(resolveLoadedPlugin(42, { ...deps, readCommandLine: () => null })).toBeNull();
	});

	it("returns null when the process names no plugin", () => {
		expect(resolveLoadedPlugin(42, { ...deps, readCommandLine: () => ["/t"] })).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/utils/loaded-plugin.test.ts`
Expected: FAIL — cannot resolve `./loaded-plugin.js`.

- [ ] **Step 3: Write the implementation**

```typescript
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The plugin a running node ACTUALLY loaded, with the hash that proves which bytes.
 *
 * This module exists because of a measured failure on 2026-08-05. The freshness check
 * reconstructed the plugin path as `plugins/@refarm/agent/plugin.wasm` while the daemon was
 * started with `--plugin .../plugins/refarm_agent/plugin.wasm`. Both files existed, in the
 * same sovereign dir, written the same day, 477,924 bytes against 476,441 — different
 * builds. So `refarm doctor` reported a fresh node, correctly, about a file nothing loads,
 * and two agents lost a diagnosis to it.
 *
 * The lesson is not "fix the path". A reconstructed path drifts again the next time an
 * installer moves; the process's own argv cannot. Read what it was started with.
 */
export interface LoadedPlugin {
	path: string;
	/** `null` when the file could not be hashed — paired with `unreadableReason`, never bare. */
	sha256: string | null;
	unreadableReason?: string;
}

export interface LoadedPluginDeps {
	readCommandLine?(pid: number): string[] | null;
	hashFile?(path: string): string | null;
}

/**
 * The value of the first `--plugin` in an argv, in either the separated or the `=` form.
 *
 * FIRST, not last: the host reads its own argv the same way, and a report that disagreed
 * with the process about which of two flags won would be a new instrument telling a new lie.
 * A dangling `--plugin` yields `undefined` rather than swallowing whatever follows.
 */
export function parsePluginArgFromCommandLine(commandLine: string[]): string | undefined {
	for (let i = 0; i < commandLine.length; i += 1) {
		const arg = commandLine[i];
		if (arg === "--plugin") {
			const value = commandLine[i + 1];
			return value && !value.startsWith("--") ? value : undefined;
		}
		if (arg?.startsWith("--plugin=")) {
			const value = arg.slice("--plugin=".length);
			return value.length > 0 ? value : undefined;
		}
	}
	return undefined;
}

function defaultReadCommandLine(pid: number): string[] | null {
	try {
		// NUL-separated, with a trailing NUL — the empty tail is dropped, not kept as an arg.
		const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
		const parts = raw.split("\0").filter((p) => p.length > 0);
		return parts.length > 0 ? parts : null;
	} catch {
		return null;
	}
}

function defaultHashFile(target: string): string | null {
	try {
		return createHash("sha256").update(readFileSync(target)).digest("hex");
	} catch {
		return null;
	}
}

/**
 * `null` means this could not be established at all — a process that is gone, or one naming
 * no plugin. An unhashable file is NOT null: the path is a real finding on its own, and
 * flattening it to null would lose the difference between "no plugin" and "a plugin I cannot
 * read", which is exactly the two-states-where-three-belong mistake this work exists to undo.
 */
export function resolveLoadedPlugin(pid: number, deps: LoadedPluginDeps = {}): LoadedPlugin | null {
	const readCommandLine = deps.readCommandLine ?? defaultReadCommandLine;
	const hashFile = deps.hashFile ?? defaultHashFile;

	const commandLine = readCommandLine(pid);
	if (!commandLine) return null;

	const pluginPath = parsePluginArgFromCommandLine(commandLine);
	if (!pluginPath) return null;

	const sha256 = hashFile(pluginPath);
	return sha256
		? { path: pluginPath, sha256 }
		: { path: pluginPath, sha256: null, unreadableReason: "the loaded plugin could not be read to hash it" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/utils/loaded-plugin.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/refarm run type-check
git add apps/refarm/src/utils/loaded-plugin.ts apps/refarm/src/utils/loaded-plugin.test.ts
git commit -m "feat(context): read the plugin a node actually loaded, and hash it"
```

---

### Task 2: The freshness check stops watching an abandoned path

**Files:**
- Modify: `apps/refarm/src/utils/runtime-freshness.ts:252-255`
- Modify: `apps/refarm/src/commands/doctor.ts:383-401`
- Test: `apps/refarm/src/utils/runtime-freshness.test.ts`

**Interfaces:**
- Consumes: `resolveLoadedPlugin` from Task 1.
- Produces: `defaultAgentPluginPath` gains a `loadedPath` parameter that takes precedence over the reconstructed one; when a loaded path is known, the reconstructed guess is not used at all.

- [ ] **Step 1: Write the failing test**

```typescript
describe("defaultAgentPluginPath", () => {
	it("prefers the path the process actually loaded over any reconstruction", () => {
		expect(
			defaultAgentPluginPath("/home/op/.refarm", "/home/op/.refarm/plugins/refarm_agent/plugin.wasm"),
		).toBe("/home/op/.refarm/plugins/refarm_agent/plugin.wasm");
	});

	it("falls back to the conventional path only when the loaded one is unknown", () => {
		expect(defaultAgentPluginPath("/home/op/.refarm", undefined)).toContain("plugins");
	});

	it("returns null without a sovereign dir and without a loaded path", () => {
		expect(defaultAgentPluginPath(undefined, undefined)).toBeNull();
	});

	it("returns the loaded path even without a sovereign dir — the process is the better witness", () => {
		expect(defaultAgentPluginPath(undefined, "/somewhere/plugin.wasm")).toBe("/somewhere/plugin.wasm");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/utils/runtime-freshness.test.ts -t defaultAgentPluginPath`
Expected: FAIL — the function takes one argument.

- [ ] **Step 3: Widen the resolver**

Replace `apps/refarm/src/utils/runtime-freshness.ts:252-255`:

```typescript
/**
 * Which agent plugin file to compare against the running process.
 *
 * `loadedPath` WINS when known, and the reason is a defect measured on 2026-08-05: this
 * function returned `plugins/@refarm/agent/plugin.wasm` while the daemon had been started
 * with `plugins/refarm_agent/plugin.wasm`. Both existed in the same sovereign dir, written
 * the same day, 477,924 bytes against 476,441. The installer converged on one directory and
 * this watcher stayed pointed at the other, so a node running a stale build was reported
 * fresh — twice, to two different agents.
 *
 * The conventional path survives ONLY as the fallback for a node whose argv cannot be read.
 * It is a guess, it is labelled as one here, and it is never preferred over the witness.
 */
export function defaultAgentPluginPath(
	sovereignDir: string | undefined,
	loadedPath: string | undefined,
): string | null {
	if (loadedPath) return loadedPath;
	if (!sovereignDir) return null;
	return path.join(sovereignDir, "plugins", "@refarm", "agent", "plugin.wasm");
}
```

- [ ] **Step 4: Feed it the witness**

In `apps/refarm/src/commands/doctor.ts`, inside `resolveFreshness()`, after the descriptor is read:

```typescript
			const loaded = resolveLoadedPlugin(descriptor.pid);
			return resolveRuntimeFreshness(
				{ pid: descriptor.pid, startedAt: descriptor.startedAt },
				defaultAgentPluginPath(nodeHome, loaded?.path),
				undefined,
				defaultRateCatalogPath(nodeHome),
			);
```

Import `resolveLoadedPlugin` from `../utils/loaded-plugin.js`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/utils/runtime-freshness.test.ts src/commands/doctor.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 6: PROVE IT FIRES — the step this plan exists for**

Inspection is not proof. `runtime:stale` passed inspection and did not fire. Deliberately stale the loaded artifact and assert the finding appears:

```bash
# Record the truth first.
refarm doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('before:', d.get('ok'), len(d.get('findings') or []))"
LOADED=$(tr '\0' '\n' < /proc/$(pgrep -f 'tractor --plugin' | head -1)/cmdline | grep -A1 -x -- --plugin | tail -1)
echo "loaded: $LOADED"
ORIGINAL_MTIME=$(stat -c %y "$LOADED")        # capture BEFORE touching anything
echo "original mtime: $ORIGINAL_MTIME"
touch "$LOADED"                                # newer than the process, not one byte changed
refarm doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('after:', [f.get('diagnostic') for f in (d.get('findings') or [])])"
touch -d "$ORIGINAL_MTIME" "$LOADED"           # put the clock back exactly
stat -c %y "$LOADED"                           # must equal ORIGINAL_MTIME
refarm doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('restored:', d.get('ok'), len(d.get('findings') or []))"
```

Expected: `before` clean; `after` contains `runtime:stale`; `restored` back to clean with the mtime
identical to the captured one. If `after` does not contain the finding, STOP — the fix is incomplete
and the check is still blind. Record the raw output at all three points.

Two deliberate choices here, and the second was a defect in an earlier draft of this plan:

- **`touch`, not a rebuild.** It changes the mtime the check reads without altering the bytes the
  node is executing, so the operator's node keeps serving correctly throughout.
- **`touch -d`, never `cp` from a backup.** A copy rewrites the file *now*, so the restored mtime
  would be newer than the process start and the node would report stale permanently, until the
  operator restarted it — the proof would leave behind the exact condition it was testing for. Since
  `touch` never touches content, no backup is needed at all; only the clock has to be put back.

- [ ] **Step 7: Commit with the evidence**

```bash
git add apps/refarm/src/utils/runtime-freshness.ts apps/refarm/src/commands/doctor.ts apps/refarm/src/utils/runtime-freshness.test.ts
git commit -m "fix(doctor): the freshness check was watching a file nothing loads"
```

---

### Task 3: `refarm context`

**Files:**
- Create: `apps/refarm/src/commands/context.ts`
- Test: `apps/refarm/src/commands/context.test.ts`
- Modify: the CLI command registry (find it with `grep -rn "\.addCommand\|createAskCommand" apps/refarm/src/index.ts`)

**Interfaces:**
- Consumes: `resolveLoadedPlugin` (Task 1), `defaultAgentPluginPath` (Task 2).
- Produces: `export function buildContextReport(input: ContextInput): ContextReport` — pure; and a `context` subcommand supporting `--json`.

`ContextInput` carries what the impure edge resolved: `{ mode, sovereignHome, homeSource, base, baseSource, namespace, credentialSource, node, loadedPlugin, builtPluginPath, builtPluginSha, otherSovereignDirs }`. `ContextReport` mirrors it and adds `divergences: Divergence[]`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildContextReport } from "./context.js";

const BASE = {
	mode: "node-global" as const,
	sovereignHome: "/home/op/.refarm",
	homeSource: "declared" as const,
	base: "/home/op",
	baseSource: "SOVEREIGN_BASE" as const,
	namespace: "default",
	credentialSource: "silo-oauth",
	node: { name: "sede", pid: 2025451, port: 7777, startedAt: "2026-08-05T17:28:00Z" },
	loadedPlugin: { path: "/home/op/.refarm/plugins/refarm_agent/plugin.wasm", sha256: "22dbabbd" },
	builtPluginPath: "/repo/packages/agent/dist/agent.wasm",
	builtPluginSha: "22dbabbd",
	otherSovereignDirs: [],
};

describe("buildContextReport", () => {
	it("names the mode, the home, and HOW the home was chosen", () => {
		const r = buildContextReport(BASE);
		expect(r.mode).toBe("node-global");
		expect(r.sovereignHome).toBe("/home/op/.refarm");
		expect(r.homeSource).toBe("declared");
	});

	it("is silent when the loaded plugin matches the built one", () => {
		expect(buildContextReport(BASE).divergences).toEqual([]);
	});

	it("reports a hash mismatch — the case a path comparison would call fine", () => {
		const r = buildContextReport({ ...BASE, builtPluginSha: "68af329e" });
		expect(r.divergences.map((d) => d.kind)).toContain("plugin-hash-mismatch");
	});

	it("reports a sovereign dir that exists and is loaded by nothing", () => {
		const r = buildContextReport({ ...BASE, otherSovereignDirs: ["/repo/.refarm"] });
		expect(r.divergences.map((d) => d.kind)).toContain("unloaded-sovereign-dir");
	});

	it("an unhashable loaded plugin is UNKNOWN, never a match and never a mismatch", () => {
		const r = buildContextReport({
			...BASE,
			loadedPlugin: { path: "/x.wasm", sha256: null, unreadableReason: "could not read" },
		});
		expect(r.divergences.map((d) => d.kind)).toContain("plugin-hash-unknown");
		expect(r.divergences.map((d) => d.kind)).not.toContain("plugin-hash-mismatch");
	});

	it("a node that is not running yields no plugin divergence at all, not a false clean", () => {
		const r = buildContextReport({ ...BASE, node: null, loadedPlugin: null });
		expect(r.divergences.map((d) => d.kind)).toContain("node-not-running");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/context.test.ts`
Expected: FAIL — cannot resolve `./context.js`.

- [ ] **Step 3: Implement `buildContextReport`**

Pure. It compares what it was given and emits a `Divergence[]`. The five kinds the tests name are the whole vocabulary: `plugin-hash-mismatch`, `plugin-hash-unknown`, `unloaded-sovereign-dir`, `node-not-running`, and nothing else without a test that demands it. Each divergence carries `kind`, a `summary` naming both sides with their hashes, and no `action` that performs anything — this command never restarts and never writes.

- [ ] **Step 4: Wire the impure edge and register the command**

`refarm context` and `refarm context --json`. The text form prints the mode, home (and how chosen), base, namespace, credential source, node identity/port/pid, and the loaded plugin with a short hash — then the divergences, or a single line saying there are none. The JSON form is the same data with no prose.

Follow the registration pattern of a neighbouring command; do not invent a new one.

- [ ] **Step 5: Run the tests, type-check, run the package suite**

```bash
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/context.test.ts
pnpm --filter @refarm.dev/refarm run type-check
pnpm --filter @refarm.dev/refarm run test
```

- [ ] **Step 6: Run it against the real node and paste the output into the report**

```bash
pnpm --filter @refarm.dev/refarm run build
refarm context
refarm context --json
```

Expected on this machine: mode `node-global`, home `~/.refarm`, node `sede`, and — because the repo tree holds abandoned copies — an `unloaded-sovereign-dir` divergence naming `<repo>/.refarm`.

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/context.ts apps/refarm/src/commands/context.test.ts apps/refarm/src/index.ts
git commit -m "feat(context): one command says which sovereign state is active"
```

---

### Task 4: The divergence finding reaches `refarm doctor`

**Files:**
- Create: `apps/refarm/src/commands/sovereign-divergence-doctor.ts`
- Test: `apps/refarm/src/commands/sovereign-divergence-doctor.test.ts`
- Modify: `apps/refarm/src/commands/doctor.ts` to include the new finding

**Interfaces:**
- Consumes: `Divergence[]` from Task 3.
- Produces: `export function buildSovereignDivergenceDoctorRecommendations(divergences: Divergence[]): RefarmDoctorRecommendation[]` — pure over an already-resolved list, exactly like `buildRuntimeFreshnessDoctorRecommendations`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildSovereignDivergenceDoctorRecommendations } from "./sovereign-divergence-doctor.js";

describe("buildSovereignDivergenceDoctorRecommendations", () => {
	it("is silent when nothing diverges — the ordinary case deserves silence", () => {
		expect(buildSovereignDivergenceDoctorRecommendations([])).toEqual([]);
	});

	it("reports a hash mismatch and names both sides", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "plugin-hash-mismatch", summary: "loaded 22dbabbd, built 68af329e" },
		]);
		expect(out[0]?.diagnostic).toBe("sovereign:plugin-divergence");
		expect(out[0]?.summary).toContain("22dbabbd");
		expect(out[0]?.summary).toContain("68af329e");
	});

	it("never proposes performing a restart on the operator's behalf", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "plugin-hash-mismatch", summary: "x" },
		]);
		expect(out[0]?.action).toMatch(/operator|your call|not done for you/i);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/sovereign-divergence-doctor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement and wire it into `doctor`**

Follow `runtime-freshness-doctor.ts` exactly: a module header stating the measured failure this exists to prevent, a pure builder, `warning` severity, an `action` that names a command and stops there.

- [ ] **Step 4: Verify, then prove**

```bash
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/sovereign-divergence-doctor.test.ts
pnpm --filter @refarm.dev/refarm run test
pnpm --filter @refarm.dev/refarm run build
refarm doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([f.get('diagnostic') for f in (d.get('findings') or [])])"
```

Expected: `sovereign:plugin-divergence` does NOT appear (the loaded and built hashes match on this machine today), and an `unloaded-sovereign-dir` finding DOES, naming the repo's abandoned `.refarm`. Record the raw output.

- [ ] **Step 5: Run the repo's own gate and commit**

```bash
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/sovereign-divergence-doctor.ts apps/refarm/src/commands/sovereign-divergence-doctor.test.ts apps/refarm/src/commands/doctor.ts
git commit -m "fix(doctor): a sovereign state nothing loads is now a finding, not a silence"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| D1 — one command, one resolved answer | 3 |
| D1 — the loaded artifact reported WITH its hash | 1, 3 |
| D2 — divergence surfaced, never silently resolved | 3, 4 |
| D2 — `runtime:stale` proven to fire by deliberately staling | 2 Step 6 |
| Three states, `unknown` reported | 1, 3 (`plugin-hash-unknown`) |
| Never restart, never write | 3, 4 (asserted by test) |
| D3, D4 (launcher, parity) | **not in this plan** — plan 2 |

**Type consistency:** `LoadedPlugin`, `resolveLoadedPlugin` and `parsePluginArgFromCommandLine` are defined in Task 1 and consumed under those names in Tasks 2 and 3. `Divergence.kind` uses the same five string literals in Tasks 3 and 4. `defaultAgentPluginPath` gains its second parameter in Task 2 and every caller is updated in that same task.

**Known follow-up, out of scope:** the two installer directories still both exist and hold different bytes. This plan makes that visible rather than fixing it; converging the installers is its own work, and the handoff already records it as an open item.
