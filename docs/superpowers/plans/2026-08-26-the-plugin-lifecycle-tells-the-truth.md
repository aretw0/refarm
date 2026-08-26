# The Plugin Lifecycle Tells the Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every plugin-lifecycle surface answer only what it can observe, so an operator can tell what is installed, what is running, what is under development, and whether the node is running the code he built.

**Architecture:** Three phases in a mandatory order. D1 makes the install stop shipping what it did not build (CLI only). D2 splits one synthesized answer into facts owned by the layer that can observe each (Rust + CLI). D3 turns the existing "loads unverified" affordance from a silence into a declaration in the node's config (Rust + CLI + config). Each phase ends with a live check on the real node — D1 is what makes those checks trustworthy.

**Tech Stack:** TypeScript (`apps/refarm`, vitest), JavaScript (`packages/health`, `packages/config`, vitest), Rust (`packages/tractor`, `cargo test --lib`).

**Spec:** [`docs/superpowers/specs/2026-08-26-the-plugin-lifecycle-tells-the-truth-design.md`](../specs/2026-08-26-the-plugin-lifecycle-tells-the-truth-design.md)

## Global Constraints

- **COMMIT BEFORE PROVING A GUARD.** Every task below shows the mutation proof before the commit
  step, and that order is WRONG — `git checkout <file>` reverts to the last COMMITTED state, so
  proving a guard on uncommitted work and reverting discards the implementation with the mutation.
  Found the hard way on Task 3, where it wiped a whole in-progress edit. Commit the task first,
  then mutate, then `git checkout <file>` restores exactly the committed implementation. If a
  proof must run before a commit, revert with a targeted string-replace that asserts the mutation
  was present, never with `git checkout`.

- **Order is mandatory:** D1 → D2 → D3. Nothing below D1 can be verified until the install stops lying.
- **Every guard is shown to fail** before it lands, and the mutation must be asserted to have APPLIED before the test run — a `replace` that silently matched nothing reads as a passing guard (measured 2026-08-25).
- **Fail closed.** D1's staleness refusal and D3's inverted default both refuse on uncertainty.
- **The host never scans the plugins directory.** It receives `--plugin` paths by design; scanning would reintroduce the resolve-from-the-OS shape `docs/NO_OS_RESOLUTION.md` catalogues.
- **Nothing executable is removed automatically** (AGENTS.md §8). Stale trees and stale dev declarations are REPORTED.
- **Read the fixture before changing a contract.** Three fixtures were found pinning defects as correct on 2026-08-25. A test asserting the OLD behaviour is evidence, not an obstacle — record why it was wrong in the commit.
- **Rust commands run from `packages/tractor`** and always filtered: `cargo test --lib <filter> --quiet`. Never bare `cargo test` (CLAUDE.md §7).
- **After source edits:** `refarm agent finish --lane after-edit --run --json`. If `package-apps-refarm-validation` reports ~180000ms it TIMED OUT (ISS-149) — re-run the underlying turbo command without the ceiling and record the real verdict; do not warm the cache and re-run the lane to buy a green check.

---

## File Structure

**D1 — install honesty (CLI only)**
- Create: `apps/refarm/src/commands/node-install-freshness.ts` — pure staleness reading + refusal text. One responsibility: answer "is the tree about to be assembled older than its source".
- Create: `apps/refarm/src/commands/node-install-freshness.test.ts`
- Modify: `apps/refarm/src/commands/node-install-plan.ts` — `installVersionLabel` gains the content digest.
- Modify: `apps/refarm/src/commands/node-install.ts:160-200` — consult freshness before assembling; digest the assembled tree after.
- Modify: `apps/refarm/src/commands/node-install-plan.test.ts`

**D2 — four facts (Rust + CLI)**
- Modify: `packages/tractor/src/lib.rs:791` — retain the requested paths and per-request failure reasons.
- Modify: `packages/tractor/src/sidecar/mod.rs:547-553` — `get_plugins` stops synthesizing.
- Create: `apps/refarm/src/commands/plugin-inventory.ts` — scan `~/.refarm/plugins/*/plugin.json`, hash each wasm, produce the installed+integrity list.
- Create: `apps/refarm/src/commands/plugin-inventory.test.ts`
- Modify: `apps/refarm/src/commands/runtime-plugins.ts` — read the new host shape.
- Modify: `apps/refarm/src/commands/plugin-runtime.ts` — compose the five facts into `plugin status` / `plugin list`.

**D3 — the declared development state (Rust + CLI + config)**
- Create: `packages/config/src/plugin-development.js` — the declaration's shape, reader, and key normalisation. Pure.
- Create: `packages/config/src/plugin-development.test.js`
- Modify: `packages/tractor/src/host/plugin_host/env_and_runtime.rs:865` — `verify_wasm_integrity` takes the declaration; absent integrity + absent declaration = refuse.
- Modify: `apps/refarm/src/commands/plugin-scaffold.ts` — the WASM skeleton and the honest notice.

---

### Task 1: The install refuses a tree older than its source

**Files:**
- Create: `apps/refarm/src/commands/node-install-freshness.ts`
- Create: `apps/refarm/src/commands/node-install-freshness.test.ts`
- Modify: `apps/refarm/src/commands/node-install.ts` (after the `version` guard, before `// ── 1. Assemble ──`)

**Interfaces:**
- Consumes: `ProjectAuditor` from `@refarm.dev/health` (already exported from `packages/health/src/index.js`), whose `workspacePackageDirs(rootDir, options)` walks `DEFAULT_WORKSPACE_ROOTS = ["packages", "apps"]`.
- Produces: `readTreeFreshness(input): TreeFreshness` and `freshnessRefusal(f): string | null`, both consumed by `node-install.ts` in Step 5.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/src/commands/node-install-freshness.test.ts
import { describe, expect, it } from "vitest";
import { freshnessRefusal, readTreeFreshness } from "./node-install-freshness.js";

/**
 * MEASURED 2026-08-25. `refarm node install` reported "installed" and the label
 * `0.1.0-57ff5cc1` while packaging an `apps/refarm/dist/index.js` NINETEEN MINUTES older
 * than `plugin-capability.ts`. The checkout was CLEAN, so ISS-158's `-dirty` marker said
 * nothing: it measures GIT cleanliness, and `dist/` is gitignored.
 */
describe("an install refuses a tree older than the source it claims to carry", () => {
	it("refuses, naming the package and the lag", () => {
		const refusal = freshnessRefusal({
			state: "stale",
			packages: [{ id: "apps/refarm", staleBySeconds: 1142 }],
		});

		expect(refusal).toMatch(/apps\/refarm/u);
		expect(refusal).toMatch(/1142/u);
	});

	it("does not refuse a fresh tree", () => {
		// The negative control. Without it, "always refuse" passes every other test here.
		expect(freshnessRefusal({ state: "fresh", packages: [] })).toBeNull();
	});

	it("refuses when freshness cannot be read, never proceeding on unknown", () => {
		// Fails closed: a tree whose staleness could not be determined is not a fresh tree.
		expect(freshnessRefusal({ state: "unknown", packages: [] })).toMatch(/could not/iu);
	});

	it("reads staleness by CONTENT, so a rebuilt-but-identical dist is fresh", () => {
		// THE SECTION 4 TRAP. Deciding staleness with the same mtime comparison the installer
		// uses would inherit its blind spot. The property is "what ships differs from the
		// source", and a touched-but-unchanged file does not differ.
		const fresh = readTreeFreshness({
			packages: [{ id: "apps/refarm", srcDigest: "abc", distDigest: "abc", staleBySeconds: 900 }],
		});

		expect(fresh.state).toBe("fresh");
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-freshness.test.ts`
Expected: FAIL — `Failed to resolve import "./node-install-freshness.js"`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// apps/refarm/src/commands/node-install-freshness.ts
/**
 * PURE. Whether the tree an install is about to assemble carries the source it claims to.
 *
 * DECIDED BY CONTENT, NOT BY MTIME, and that choice is the point. `ProjectAuditor` reports
 * `staleBySeconds` from mtimes, which is the right signal for a health WARNING and the wrong
 * one for a REFUSAL: a checkout, a `touch`, or a rebuild that produced identical bytes all
 * move an mtime without changing what ships. A refusal derived from the same proxy the
 * installer uses would share its blind spot and could not report it (AGENTS.md §9).
 */
export interface PackageFreshness {
	readonly id: string;
	readonly srcDigest: string | null;
	readonly distDigest: string | null;
	readonly staleBySeconds: number;
}

export interface TreeFreshness {
	readonly state: "fresh" | "stale" | "unknown";
	readonly packages: readonly { id: string; staleBySeconds: number }[];
}

export function readTreeFreshness(input: {
	readonly packages: readonly PackageFreshness[];
}): TreeFreshness {
	const undecidable = input.packages.filter((p) => p.srcDigest === null || p.distDigest === null);
	if (undecidable.length > 0) return { state: "unknown", packages: [] };

	const stale = input.packages
		.filter((p) => p.srcDigest !== p.distDigest)
		.map((p) => ({ id: p.id, staleBySeconds: p.staleBySeconds }));

	return stale.length > 0
		? { state: "stale", packages: stale }
		: { state: "fresh", packages: [] };
}

/** The sentence an operator reads, or null when there is nothing to refuse. */
export function freshnessRefusal(freshness: TreeFreshness): string | null {
	if (freshness.state === "fresh") return null;
	if (freshness.state === "unknown") {
		return (
			"freshness could not be read for the workspace being assembled, and an install that " +
			"cannot tell whether it carries your source is not one you can trust. Build, then retry."
		);
	}
	const named = freshness.packages
		.map((p) => `${p.id} (source is ${p.staleBySeconds}s ahead of dist)`)
		.join(", ");
	return `the tree would ship code older than the source: ${named}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-freshness.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into the installer**

In `apps/refarm/src/commands/node-install.ts`, immediately after the `version` guard and BEFORE `const commit = currentCommit(...)`:

```typescript
	// D1. The detection already existed and the installer did not ask (measured 2026-08-25):
	// `ProjectAuditor` walks `["packages", "apps"]` and covers `apps/refarm`, and would have
	// named the 19-minute-old dist that shipped under a clean checkout's label.
	const freshness = readTreeFreshness({ packages: measureWorkspaceFreshness(repoRoot) });
	const refusal = freshnessRefusal(freshness);
	if (refusal) {
		return {
			status: "refused",
			because: refusal,
			nextCommand: "pnpm --filter @refarm.dev/refarm run build",
		};
	}
```

- [ ] **Step 5b: Define the impure half — the build stamp**

> **REFINEMENT TO THE SPEC'S D1, discovered while writing this task.** D1 says "consult the
> staleness check that already exists", and that check decides by MTIME. D4 says the guard must
> measure by CONTENT or it inherits the proxy's blind spot. Writing the code, the two do not
> close: a `git checkout` moves mtimes without changing what ships, so an mtime-based REFUSAL
> refuses spuriously — and a daily-driver command that refuses spuriously gets worked around,
> which is exactly how `plugin new` became a dead end. One primitive settles both: the build
> stamps the source digest INTO `dist`, and the install recomputes and compares. It is exact, it
> costs one file, and it hands Task 2 the content digest for free. The mtime check keeps its
> existing job — a health WARNING, which is the right severity for a weak signal.

Add to `apps/refarm/src/commands/node-install-freshness.ts`:

```typescript
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The file a build writes so an installer can tell whether `dist` carries this source. */
export const SOURCE_STAMP = ".source-digest";

/** PURE-ish. A stable digest of every file under `dir`, by relative path and content. */
export function digestTree(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const hash = createHash("sha256");
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			if (entry.name === "node_modules" || entry.name === SOURCE_STAMP) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else hash.update(path.relative(dir, full)).update(readFileSync(full));
		}
	};
	walk(dir);
	return hash.digest("hex");
}

/** The workspaces an install assembles, each measured by CONTENT.
 *
 * `staleBySeconds` is carried for the REFUSAL TEXT only — an operator reads "19 minutes"
 * faster than two hashes. It never decides anything. */
export function measureWorkspaceFreshness(repoRoot: string): PackageFreshness[] {
	const pkgDir = path.join(repoRoot, "apps", "refarm");
	const srcDir = path.join(pkgDir, "src");
	const distDir = path.join(pkgDir, "dist");
	const stampPath = path.join(distDir, SOURCE_STAMP);
	const srcDigest = digestTree(srcDir);
	const distDigest = existsSync(stampPath) ? readFileSync(stampPath, "utf-8").trim() : null;
	const lag =
		existsSync(srcDir) && existsSync(distDir)
			? Math.max(0, Math.round((newestMtime(srcDir) - newestMtime(distDir)) / 1000))
			: 0;
	return [{ id: "apps/refarm", srcDigest, distDigest, staleBySeconds: lag }];
}

function newestMtime(dir: string): number {
	let newest = 0;
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else newest = Math.max(newest, statSync(full).mtimeMs);
		}
	};
	walk(dir);
	return newest;
}
```

And in `apps/refarm/package.json`, the `build` script gains the stamp as its last step:

```json
"build": "tsc --project tsconfig.build.json && node -e \"import('./src/commands/node-install-freshness.js')\" || true"
```

> Written as a separate step because it is the one line that makes the stamp exist. A build that
> does not stamp leaves `distDigest: null`, which reads as `unknown`, which REFUSES — fails closed,
> the direction the Global Constraints require.

- [ ] **Step 6: Prove the guard fires, asserting the mutation applied**

```bash
cd /home/s095407044/github/refarm
python3 -c "
p='apps/refarm/src/commands/node-install-freshness.ts'; s=open(p).read()
old='  .filter((p) => p.srcDigest !== p.distDigest)'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'  .filter(() => false)',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-freshness.test.ts
git checkout apps/refarm/src/commands/node-install-freshness.ts
```

Expected: the "refuses, naming the package and the lag" test goes RED, then green after the checkout.

- [ ] **Step 7: Commit**

```bash
git add apps/refarm/src/commands/node-install-freshness.ts \
        apps/refarm/src/commands/node-install-freshness.test.ts \
        apps/refarm/src/commands/node-install.ts
git commit -m "fix(install): a tree older than its source is refused, not shipped"
```

---

### Task 2: The label distinguishes two trees from the same commit

**Files:**
- Modify: `apps/refarm/src/commands/node-install-plan.ts:36-46` (`installVersionLabel`)
- Modify: `apps/refarm/src/commands/node-install-plan.test.ts`
- Modify: `apps/refarm/src/commands/node-install.ts` (digest the assembled tree, pass it to the label)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `installVersionLabel(version, commit, dirty, contentDigest?)` — Task 3 and beyond do not use it; `refarm health`'s `nodeSubstrate.identity.label` reads it.

- [ ] **Step 1: Write the failing test**

```typescript
// append to apps/refarm/src/commands/node-install-plan.test.ts
describe("the label tells two trees from one commit apart", () => {
	it("carries a content digest beside the commit", () => {
		// The docstring's own promise: "two installs of 0.1.0 from different commits are
		// different trees, and an operator rolling back has to tell them apart in a directory
		// listing". MEASURED 2026-08-25: two installs from the SAME commit, minutes apart,
		// produced different code under ONE directory name.
		const a = installVersionLabel("0.1.0", "57ff5cc1", false, "aaaaaaaa");
		const b = installVersionLabel("0.1.0", "57ff5cc1", false, "bbbbbbbb");

		expect(a).not.toBe(b);
		expect(a).toMatch(/57ff5cc1/u);
	});

	it("omits the digest when there is none, rather than inventing one", () => {
		// Same discipline the commit already follows: an install from a tarball has no commit,
		// and inventing one produces a label that looks traceable and is not.
		expect(installVersionLabel("0.1.0", "57ff5cc1", false)).toBe("0.1.0-57ff5cc1");
	});

	it("still qualifies a dirty install, which is a different fact", () => {
		expect(installVersionLabel("0.1.0", "57ff5cc1", true, "aaaaaaaa")).toMatch(/dirty/u);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-plan.test.ts`
Expected: FAIL — the two labels are equal, because the fourth argument is ignored.

- [ ] **Step 3: Extend the label**

```typescript
export function installVersionLabel(
	version: string,
	commit: string | null,
	dirty = false,
	contentDigest?: string,
): string {
	const short = commit?.trim();
	if (!short) return version;
	// THE DIGEST GOES IN THE DIRECTORY NAME, not beside it in a record, because the promise this
	// function makes is about a DIRECTORY LISTING. Measured 2026-08-25: two clean installs of
	// 57ff5cc1 carried different code under one name, and `installedAt` — which this docstring
	// already offers as the tiebreak for two dirty installs — does not say the content differs.
	const digest = contentDigest?.trim();
	const base = digest ? `${version}-${short}-${digest}` : `${version}-${short}`;
	return dirty ? `${base}-dirty` : base;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the guard fires**

```bash
python3 -c "
p='apps/refarm/src/commands/node-install-plan.ts'; s=open(p).read()
old='const base = digest ? \`\${version}-\${short}-\${digest}\` : \`\${version}-\${short}\`;'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'const base = \`\${version}-\${short}\`;',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/node-install-plan.test.ts
git checkout apps/refarm/src/commands/node-install-plan.ts
```

Expected: "carries a content digest beside the commit" goes RED.

- [ ] **Step 6: Commit, then verify LIVE**

```bash
git add apps/refarm/src/commands/node-install-plan.ts apps/refarm/src/commands/node-install-plan.test.ts
git commit -m "fix(install): the label distinguishes two trees assembled from one commit"
refarm agent finish --lane after-edit --run --json
pnpm --filter @refarm.dev/refarm run build && refarm node install --json
refarm health | tail -4
```

Expected: the installed tree's directory name now carries a digest, and `refarm health`'s substrate line names it.

---

### Task 3: The host reports what it was asked for and what loaded

**Files:**
- Modify: `packages/tractor/src/lib.rs` (near `plugin_paths`, line 791)
- Modify: `packages/tractor/src/sidecar/mod.rs:547-553` (`get_plugins`)

**Interfaces:**
- Consumes: nothing from D1.
- Produces: the `/plugins` payload `{ requested: [{id, path, loaded, because}], loaded: [id], defaultResponder }` — consumed by Task 5's `runtime-plugins.ts`.

- [ ] **Step 1: Write the failing test**

```rust
// in packages/tractor/src/sidecar/mod.rs's test module
#[test]
fn requested_and_loaded_are_separate_facts() {
    // MEASURED 2026-08-25: `installed`, `loaded` and `known` were THE SAME VARIABLE and
    // `local` was a literal `[]`. So a plugin handed to the host that failed to load vanished
    // from the answer entirely, and the silence was indistinguishable from never having been
    // asked for.
    //
    // THE §9 TRAP THIS TEST EXISTS AGAINST: asserting `requested.len() == loaded.len()` PASSES
    // under the old code, because they were one list. So this constructs a state where they
    // MUST differ and asserts that they do.
    let payload = plugins_payload(
        &[
            ("agent".to_string(), "/p/agent.wasm".into(), Some("agent".to_string())),
            ("bad".to_string(), "/p/bad.wasm".into(), None),
        ],
        &["agent".to_string()],
        "agent",
    );

    let requested = payload["requested"].as_array().expect("requested is an array");
    assert_eq!(requested.len(), 2, "both were asked for");
    assert_eq!(payload["loaded"].as_array().unwrap().len(), 1, "only one loaded");

    let failed = requested.iter().find(|r| r["id"] == "bad").expect("the failure is reported");
    assert_eq!(failed["loaded"], false);
    assert!(failed["because"].is_string(), "a request that did not load says why");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tractor && cargo test --lib requested_and_loaded --quiet
```
Expected: FAIL to compile — `plugins_payload` does not exist.

- [ ] **Step 3: Extract the pure payload builder and use it**

```rust
/// PURE. The plugins answer, built from the two facts the host actually holds.
///
/// It reports `requested` (the `--plugin` paths it was handed, each with whether it became a
/// channel and, when it did not, why) and `loaded`. It does NOT report `installed` or `known`:
/// the daemon receives explicit paths and does not scan, so those are the CLI's to answer and
/// the host answering them was the defect — one variable served under four names.
fn plugins_payload(
    requested: &[(String, std::path::PathBuf, Option<String>)],
    loaded: &[String],
    default_responder: &str,
) -> serde_json::Value {
    let rows: Vec<serde_json::Value> = requested
        .iter()
        .map(|(id, path, loaded_as)| {
            serde_json::json!({
                "id": id,
                "path": path.to_string_lossy(),
                "loaded": loaded_as.is_some(),
                "because": loaded_as.as_ref().map_or(
                    serde_json::Value::String("did not become a channel".to_string()),
                    |_| serde_json::Value::Null,
                ),
            })
        })
        .collect();
    serde_json::json!({
        "requested": rows,
        "loaded": loaded,
        "defaultResponder": default_responder,
    })
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd packages/tractor && cargo test --lib requested_and_loaded --quiet
```
Expected: PASS.

- [ ] **Step 5: Prove the guard fires, asserting the mutation applied**

```bash
cd /home/s095407044/github/refarm
python3 -c "
p='packages/tractor/src/sidecar/mod.rs'; s=open(p).read()
old='\"requested\": rows,'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'\"requested\": loaded,',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
cd packages/tractor && cargo test --lib requested_and_loaded --quiet
cd .. && git checkout packages/tractor/src/sidecar/mod.rs
```

Expected: RED — collapsing the two back into one variable is exactly the defect.

- [ ] **Step 6: Commit**

```bash
git add packages/tractor/src/sidecar/mod.rs packages/tractor/src/lib.rs
git commit -m "fix(host): the plugins answer stops serving one fact under four names"
```

---

### Task 4: The CLI enumerates installed trees and their integrity

**Files:**
- Create: `apps/refarm/src/commands/plugin-inventory.ts`
- Create: `apps/refarm/src/commands/plugin-inventory.test.ts`

**Interfaces:**
- Consumes: `installedPluginDir` / `pluginsBaseDir` from `apps/refarm/src/commands/plugin-install-path.ts`.
- Produces: `readInstalledPlugins(baseDir): InstalledPlugin[]` where `InstalledPlugin = { manifestId, runtimeId, dir, integrity: "matches" | "mismatch" | "absent" }` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/refarm/src/commands/plugin-inventory.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readInstalledPlugins } from "./plugin-inventory.js";

/**
 * MEASURED on the operator's node 2026-08-25: FOUR installed trees, and `refarm plugin list`
 * reported ONE under every `--origin` filter, while `plugin status` reported the two that
 * loaded. Between them, an installed-but-unloaded tree was invisible on every surface.
 */
describe("what is installed here, and does each tree hash to what it claims", () => {
	function tree(base: string, dirName: string, id: string, bytes: string, declared: string | null) {
		const dir = path.join(base, dirName);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "plugin.wasm"), bytes);
		writeFileSync(
			path.join(dir, "plugin.json"),
			JSON.stringify({ id, ...(declared ? { integrity: declared } : {}) }),
		);
	}

	it("lists a tree that is installed and NOT loaded — the state that had no surface", () => {
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_ghost", "@refarm/ghost", "bytes", null);

		expect(readInstalledPlugins(base).map((p) => p.manifestId)).toEqual(["@refarm/ghost"]);
	});

	it("reports a declared hash that does not match, without dropping the tree", () => {
		// The operator's own node carried `sha256-000000…` against real bytes. A listing that
		// omitted it would hide 476KB of executable from the only surface that could name it.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_stale", "@refarm/stale", "bytes", "sha256-0000000000");

		const [entry] = readInstalledPlugins(base);
		expect(entry.integrity).toBe("mismatch");
	});

	it("distinguishes an ABSENT claim from a wrong one", () => {
		// D3 rests on this distinction: absent means "unsigned, possibly under development";
		// wrong means "tampered or replaced". Collapsing them is what made the operator's stale
		// tree ambiguous.
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_dev", "@refarm/dev", "bytes", null);

		expect(readInstalledPlugins(base)[0].integrity).toBe("absent");
	});

	it("projects both id vocabularies, since three spellings are live", () => {
		// `plugin:tem` crosses every projection unreduced. `plugin permissions` needs the
		// manifest id and no listing surface published it (measured 2026-08-25).
		const base = mkdtempSync(path.join(tmpdir(), "inv-"));
		tree(base, "refarm_lsp-code-ops", "@refarm/lsp-code-ops", "bytes", null);

		const [entry] = readInstalledPlugins(base);
		expect(entry.manifestId).toBe("@refarm/lsp-code-ops");
		expect(entry.runtimeId).toBe("lsp-code-ops");
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/plugin-inventory.test.ts`
Expected: FAIL — `Failed to resolve import "./plugin-inventory.js"`.

- [ ] **Step 3: Write the scan**

```typescript
// apps/refarm/src/commands/plugin-inventory.ts
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pluginIdRuntimeToken } from "@refarm.dev/config/plugin-identity";

/** THREE STATES, never two. `absent` is "no claim was made" and is what an unsigned plugin
 *  under development looks like (D3); `mismatch` is "the claim is wrong", which the host
 *  treats as a hard load failure. Collapsing them is what made a stale tree ambiguous. */
export type IntegrityVerdict = "matches" | "mismatch" | "absent";

export interface InstalledPlugin {
	readonly manifestId: string;
	readonly runtimeId: string;
	readonly dir: string;
	readonly integrity: IntegrityVerdict;
}

/** Every tree under the node's plugins directory, whether the daemon was handed it or not.
 *  The host receives explicit `--plugin` paths and does not scan, so this enumeration is the
 *  CLI's to answer — and until now nothing answered it. */
export function readInstalledPlugins(baseDir: string): InstalledPlugin[] {
	if (!existsSync(baseDir)) return [];
	const out: InstalledPlugin[] = [];
	for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = path.join(baseDir, entry.name);
		const manifestPath = path.join(dir, "plugin.json");
		if (!existsSync(manifestPath)) continue;
		let manifest: { id?: unknown; integrity?: unknown };
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		} catch {
			continue; // an unreadable manifest is not a tree we can name
		}
		if (typeof manifest.id !== "string") continue;
		out.push({
			manifestId: manifest.id,
			runtimeId: pluginIdRuntimeToken(manifest.id),
			dir,
			integrity: verdictFor(dir, manifest.integrity),
		});
	}
	return out.sort((a, b) => a.manifestId.localeCompare(b.manifestId));
}

function verdictFor(dir: string, declared: unknown): IntegrityVerdict {
	if (typeof declared !== "string" || declared.trim() === "") return "absent";
	const wasm = path.join(dir, "plugin.wasm");
	if (!existsSync(wasm)) return "mismatch";
	const computed = createHash("sha256").update(readFileSync(wasm)).digest("hex");
	const hex = declared.trim().toLowerCase().replace(/^sha256[-:]/u, "");
	return hex === computed ? "matches" : "mismatch";
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/plugin-inventory.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the guards fire**

```bash
python3 -c "
p='apps/refarm/src/commands/plugin-inventory.ts'; s=open(p).read()
old='if (typeof declared !== \"string\" || declared.trim() === \"\") return \"absent\";'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'if (typeof declared !== \"string\") return \"mismatch\";',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/plugin-inventory.test.ts
git checkout apps/refarm/src/commands/plugin-inventory.ts
```

Expected: "distinguishes an ABSENT claim from a wrong one" goes RED.

- [ ] **Step 6: Commit**

```bash
git add apps/refarm/src/commands/plugin-inventory.ts apps/refarm/src/commands/plugin-inventory.test.ts
git commit -m "feat(plugin): the node can say which trees are installed and whether each hashes true"
```

---

### Task 5: `plugin status` and `plugin list` compose the five facts

**Files:**
- Modify: `apps/refarm/src/commands/runtime-plugins.ts:49-64` (read the new host shape)
- Modify: `apps/refarm/src/commands/plugin-runtime.ts:240-258` (compose)
- Modify: `apps/refarm/test/commands/plugin-capability.test.ts`

**Interfaces:**
- Consumes: Task 3's `/plugins` payload; Task 4's `readInstalledPlugins`.
- Produces: `plugin status --json` carrying `{ id, runtimeId, manifestId, requested, loaded, installed, integrity }` per plugin — read by Task 8's live verification.

- [ ] **Step 1: Write the failing test**

```typescript
// append to apps/refarm/test/commands/plugin-capability.test.ts
describe("status reports five facts, and they can disagree", () => {
	it("shows a tree that is installed and not loaded", async () => {
		// THE TRAP: an assertion that `installed` and `loaded` are equal PASSED under the old
		// code because they were one variable. So this constructs disagreement and asserts it.
		const group = createPluginCapabilityGroup(
			makeDeps({
				readRuntimePluginState: async () => ({
					requested: [{ id: "agent", path: "/p/agent.wasm", loaded: true, because: null }],
					loaded: ["agent"],
					defaultResponder: "agent",
				}),
				readInstalledPlugins: () => [
					{ manifestId: "@refarm/agent", runtimeId: "agent", dir: "/p/refarm_agent", integrity: "matches" },
					{ manifestId: "@refarm/ghost", runtimeId: "ghost", dir: "/p/refarm_ghost", integrity: "absent" },
				],
			}),
		);

		const env = (await action(group, "status").run(input({}))) as unknown as {
			plugins: Array<{ runtimeId: string; installed: boolean; loaded: boolean }>;
		};
		const ghost = env.plugins.find((p) => p.runtimeId === "ghost");

		expect(ghost).toBeDefined();
		expect(ghost?.installed).toBe(true);
		expect(ghost?.loaded).toBe(false);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/plugin-capability.test.ts`
Expected: FAIL — `ghost` is undefined, because status only reports what loaded.

- [ ] **Step 3: Compose the facts**

In `plugin-runtime.ts`, replace the `known.map(...)` block:

```typescript
		// FIVE FACTS, each from whoever can observe it. `requested`/`loaded` come from the host
		// (it holds both and used to report one); `installed`/`integrity` from the CLI's scan,
		// because the daemon receives explicit paths and does not scan.
		plugins: mergePluginFacts(state, installed).map((p) => ({
			id: p.manifestId ?? p.runtimeId,
			runtimeId: p.runtimeId,
			manifestId: p.manifestId,
			requested: p.requested,
			loaded: p.loaded,
			installed: p.installed,
			integrity: p.integrity,
		})),
```

- [ ] **Step 3b: Define the merge**

```typescript
/** PURE. One row per plugin this node has ANY fact about, from the two sides that hold them.
 *
 * The union is keyed by RUNTIME id, because that is the only vocabulary both sides speak: the
 * host was handed paths and derives `manifest_runtime_plugin_id`, and the CLI's scan reads a
 * manifest id it can project. A tree present on only one side is still a row — that asymmetry
 * IS the answer to "what is installed here and not running". */
export function mergePluginFacts(
	state: { requested: { id: string; loaded: boolean }[]; loaded: string[] },
	installed: readonly InstalledPlugin[],
): Array<{
	runtimeId: string;
	manifestId: string | null;
	requested: boolean;
	loaded: boolean;
	installed: boolean;
	integrity: IntegrityVerdict | null;
}> {
	const rows = new Map<string, ReturnType<typeof mergePluginFacts>[number]>();
	const row = (runtimeId: string) => {
		const existing = rows.get(runtimeId);
		if (existing) return existing;
		const fresh = {
			runtimeId,
			manifestId: null as string | null,
			requested: false,
			loaded: false,
			installed: false,
			integrity: null as IntegrityVerdict | null,
		};
		rows.set(runtimeId, fresh);
		return fresh;
	};

	for (const r of state.requested) {
		const entry = row(r.id);
		entry.requested = true;
		entry.loaded = r.loaded;
	}
	for (const id of state.loaded) row(id).loaded = true;
	for (const tree of installed) {
		const entry = row(tree.runtimeId);
		entry.manifestId = tree.manifestId;
		entry.installed = true;
		entry.integrity = tree.integrity;
	}
	return [...rows.values()].sort((a, b) => a.runtimeId.localeCompare(b.runtimeId));
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/plugin-capability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit, then verify LIVE — this is the step that has caught three defects**

```bash
git add apps/refarm/src/commands/runtime-plugins.ts apps/refarm/src/commands/plugin-runtime.ts \
        apps/refarm/test/commands/plugin-capability.test.ts
git commit -m "feat(plugin): status composes five facts instead of repeating one"
refarm agent finish --lane handoffs --run --json   # a public JSON contract changed
pnpm --filter @refarm.dev/refarm run build && refarm node install --json
refarm plugin status --json
```

Expected: four trees appear on the operator's node — `@refarm/agent`, `@refarm/pi-agent`,
`refarm_agent`, `refarm_lsp-code-ops` — two loaded, and the 2026-08-05 tree reported
`integrity: "mismatch"`. This closes ISS-167.

---

### Task 6: The development state is declared in the node's config

**Files:**
- Create: `packages/config/src/plugin-development.js`
- Create: `packages/config/src/plugin-development.test.js`
- Modify: `packages/config/src/index.js` (export it)

**Interfaces:**
- Consumes: `pluginIdRuntimeToken` from `packages/config/src/plugin-identity.js`.
- Produces: `readPluginDevelopment(config)` → `Map<runtimeId, { declaredAt: string }>` and `isUnderDevelopment(config, pluginId)` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

```javascript
// packages/config/src/plugin-development.test.js
import { describe, expect, it } from "vitest";
import { isUnderDevelopment, readPluginDevelopment } from "./plugin-development.js";

/**
 * The affordance already existed and was expressed by SILENCE: `verify_wasm_integrity` returns
 * Ok for a manifest with no integrity claim, documented as "an un-signed local plugin still
 * loads". So "deliberately unsigned because I am developing it" and "the claim is missing for
 * some other reason" were indistinguishable from every surface.
 */
describe("under development is a declaration this node makes", () => {
	it("keys by the RUNTIME id, the vocabulary the host looks up", () => {
		// Proven 2026-08-25 (57ff5cc1): the load path computes
		// `manifest_runtime_plugin_id(manifest.id)` and looks trust and approvals up under it.
		const config = { pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-26" } } };
		expect(isUnderDevelopment(config, "@refarm/lsp-code-ops")).toBe(true);
	});

	it("is false when nothing declared it, which is the whole point", () => {
		expect(isUnderDevelopment({}, "@refarm/lsp-code-ops")).toBe(false);
	});

	it("reads a malformed declaration as ABSENT, never as present", () => {
		// The same rule `readModelAuthorization` follows: every failure of this parser must land
		// on the state that permits nothing. The alternative is a typo widening what may run.
		expect(readPluginDevelopment({ pluginDevelopment: "all" }).size).toBe(0);
		expect(readPluginDevelopment({ pluginDevelopment: ["x"] }).size).toBe(0);
	});

	it("carries declaredAt, so the state can age out loud", () => {
		const found = readPluginDevelopment({
			pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-26" } },
		});
		expect(found.get("lsp-code-ops")?.declaredAt).toBe("2026-08-26");
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/config exec vitest run src/plugin-development.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the reader**

```javascript
// packages/config/src/plugin-development.js
import { pluginIdRuntimeToken } from "./plugin-identity.js";

/**
 * PURE. Which plugins THIS NODE has declared it is developing.
 *
 * IN THE NODE'S CONFIG, NEVER IN THE MANIFEST, and that is the load-bearing choice. A manifest
 * travels with the plugin, so an author who marked their own plugin "under development" would
 * ship an artifact that loads unverified on every node that installs it — a supply-chain hole
 * wearing a convenience's clothes. This is a statement by the operator ABOUT THIS MACHINE,
 * beside `trusted_plugins` and `modelAuthorization`.
 *
 * KEYED BY THE RUNTIME ID because that is what the load path looks up (proven 57ff5cc1).
 *
 * A MALFORMED DECLARATION READS AS ABSENT rather than as present, the same rule
 * `readModelAuthorization` follows: every failure of this parser lands on the state that
 * permits nothing.
 */
export function readPluginDevelopment(config) {
	const out = new Map();
	if (!config || typeof config !== "object" || Array.isArray(config)) return out;
	const raw = config.pluginDevelopment;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const [id, entry] of Object.entries(raw)) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const declaredAt = typeof entry.declaredAt === "string" ? entry.declaredAt.trim() : "";
		if (!declaredAt) continue;
		out.set(pluginIdRuntimeToken(id), { declaredAt });
	}
	return out;
}

/** Whether this node declared it is developing `pluginId`, in either id vocabulary. */
export function isUnderDevelopment(config, pluginId) {
	return readPluginDevelopment(config).has(pluginIdRuntimeToken(pluginId));
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @refarm.dev/config exec vitest run src/plugin-development.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the guard fires**

```bash
python3 -c "
p='packages/config/src/plugin-development.js'; s=open(p).read()
old='	if (!raw || typeof raw !== \"object\" || Array.isArray(raw)) return out;'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'	if (!raw) return out;',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
pnpm --filter @refarm.dev/config exec vitest run src/plugin-development.test.js
git checkout packages/config/src/plugin-development.js
```

Expected: "reads a malformed declaration as ABSENT" goes RED.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/plugin-development.js packages/config/src/plugin-development.test.js packages/config/src/index.js
git commit -m "feat(config): a node declares which plugins it is developing"
```

---

### Task 7: An undeclared unsigned plugin stops loading

**Files:**
- Modify: `packages/tractor/src/host/plugin_host/env_and_runtime.rs:865` (`verify_wasm_integrity`)
- Modify: `packages/tractor/src/host/plugin_host/env_and_runtime.rs:1371` (the call site)

**Interfaces:**
- Consumes: Task 6's declaration, read from `.refarm/config.json` at load, beside the existing `resolve_trusted_at_load` / `resolve_approved_at_load`.
- Produces: nothing later tasks consume.

**⚠️ THIS IS THE CONTRACT CHANGE WITH A BLAST RADIUS.** Inverting the default makes any unsigned plugin stop loading until declared. Recorded in the spec as the operator's decision; on his node all four manifests carry `integrity`, so nothing there is affected.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn an_unsigned_plugin_needs_a_declaration_to_run() {
    // The affordance existed and was expressed by SILENCE. Absence must declare itself rather
    // than be read as consent — the same rule ISS-131 tier 3 reached for credentials.
    assert!(verify_wasm_integrity(None, "abc", "ghost", false).is_err());
    assert!(verify_wasm_integrity(None, "abc", "ghost", true).is_ok());
}

#[test]
fn a_declaration_never_excuses_a_WRONG_hash() {
    // "Under development" waives an ABSENT claim, never a false one. A wrong hash is
    // "tampered or replaced" and stays a hard failure whatever the node declared.
    assert!(verify_wasm_integrity(Some("sha256-0000"), "abc", "ghost", true).is_err());
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tractor && cargo test --lib an_unsigned_plugin --quiet
```
Expected: FAIL to compile — `verify_wasm_integrity` takes three arguments.

- [ ] **Step 3: Take the declaration**

```rust
/// `None` declared = no integrity claim. This USED TO BE Ok unconditionally
/// ("backward-compatible: an un-signed local plugin still loads"), which made "deliberately
/// unsigned because I am developing it" and "the claim is missing" the same observable state.
/// It is now Ok only when the NODE declared it is developing this plugin. A declaration never
/// excuses a WRONG hash — that is "tampered or replaced" and stays a hard failure.
fn verify_wasm_integrity(
    declared: Option<&str>,
    computed_hash: &str,
    plugin_id: &str,
    under_development: bool,
) -> Result<()> {
    let Some(declared) = declared else {
        anyhow::ensure!(
            under_development,
            "plugin '{plugin_id}' declares no integrity and this node has not declared it is \
             under development — declare it, or install a signed build",
        );
        return Ok(());
    };
    // … unchanged from here …
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd packages/tractor && cargo test --lib integrity --quiet
```
Expected: PASS, including the pre-existing integrity tests.

- [ ] **Step 5: Prove the guards fire**

```bash
cd /home/s095407044/github/refarm
python3 -c "
p='packages/tractor/src/host/plugin_host/env_and_runtime.rs'; s=open(p).read()
old='            under_development,'
assert old in s, 'ANCHOR MISSING'
s2=s.replace(old,'            true,',1); assert s2!=s, 'DID NOT APPLY'
open(p,'w').write(s2); print('mutation APPLIED')"
cd packages/tractor && cargo test --lib an_unsigned_plugin --quiet
cd .. && git checkout packages/tractor/src/host/plugin_host/env_and_runtime.rs
```

Expected: "an_unsigned_plugin_needs_a_declaration_to_run" goes RED.

- [ ] **Step 6: Commit**

```bash
git add packages/tractor/src/host/plugin_host/env_and_runtime.rs
git commit -m "fix(host): an unsigned plugin runs only where the node declared it is being developed"
```

---

### Task 8: `plugin new` scaffolds what the node runs, and says what it does not

**Files:**
- Modify: `apps/refarm/src/commands/plugin-scaffold.ts:267-311`
- Modify: `apps/refarm/test/commands/plugin-scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a scaffold directory containing `plugin.json` (manifest id, no `integrity`) plus the WASM component source, and a report naming the light track as designed-and-not-built.

- [ ] **Step 1: Write the failing test**

```typescript
describe("the scaffold produces something this node can run", () => {
	it("writes a plugin.json, which is what install and the host read", async () => {
		// MEASURED 2026-08-25: the scaffold wrote `ext.json` + `index.js`; no loader consumed
		// them (the host has zero occurrences of `workerEntry`/`executionContext`),
		// `plugin install` could not install that shape, and both live plugins are WASM
		// components. A developer following the documented onboarding produced an artifact the
		// node cannot execute, and found out late.
		const report = await buildCreatedPluginReport({ name: "my-tool", isGlobal: false, cwd, homeDir });

		expect(report.files.some((f) => f.endsWith("plugin.json"))).toBe(true);
	});

	it("says the light track is designed and not built, rather than implying it works", async () => {
		const report = await buildCreatedPluginReport({ name: "my-tool", isGlobal: false, cwd, homeDir });

		expect(report.notice).toMatch(/not (yet )?built|designed/iu);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/plugin-scaffold.test.ts`
Expected: FAIL — the scaffold writes `ext.json`, and `report.notice` does not exist.

- [ ] **Step 3: Write the WASM skeleton and the notice**

```typescript
	// The scaffold writes the shape the node ACTUALLY runs: a manifest `plugin install` can
	// install and the host can load. No `integrity` — a freshly authored plugin is unsigned by
	// definition, and D3 is what makes that state declarable instead of silent.
	await writeFile(
		path.join(extDir, "plugin.json"),
		JSON.stringify({ id: `@local/${name}`, name, version: "0.1.0", capabilities: { provides: [] } }, null, 2) + "\n",
		"utf-8",
	);
```

with the report gaining:

```typescript
	notice:
		`Declare it before running it unsigned:  refarm plugin develop @local/${name}\n` +
		"A lighter, non-WASM track is designed and not built — see " +
		"docs/superpowers/specs/ for its own spec.",
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run test/commands/plugin-scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit, then walk the whole loop live**

```bash
git add apps/refarm/src/commands/plugin-scaffold.ts apps/refarm/test/commands/plugin-scaffold.test.ts
git commit -m "feat(plugin): the scaffold produces what the node runs, and names what it does not"
refarm agent finish --lane before-push --run --json
pnpm --filter @refarm.dev/refarm run build && refarm node install --json
refarm plugin new my-tool && refarm plugin status --json
```

Expected — the acceptance for the whole plan, in one sequence: the scaffold produces an
installable manifest; installing it unsigned is REFUSED naming the missing declaration;
declaring it lets it load and every surface marks it under development; and `plugin status`
reports the four trees on the node with an integrity verdict each.

---

## Self-Review

**Spec coverage.** D1 → Tasks 1–2. D2 → Tasks 3–5. D3 → Tasks 6–8. D4's guards are inside each
task rather than a task of their own, because a guard that lands separately from what it guards
is one nobody watched fail.

**Not covered by any task, deliberately:** the light execution track (its own spec, by decision);
the sandbox's promotion to first class (out of scope — it proves cost isolation and, inheriting
credentials by copy, cannot prove permission policy anyway).

**Type consistency.** `runtimeId` / `manifestId` are spelled identically in Tasks 4, 5, 6 and 8.
`IntegrityVerdict` has exactly three values in Tasks 4 and 5. `installVersionLabel`'s fourth
parameter is `contentDigest` in both Task 2 and its call site.

**One risk named rather than left to be discovered:** Task 7 inverts a default to closed. On the
operator's node nothing is affected (all four manifests carry `integrity`), but any node carrying
an unsigned plugin loses it until declared. That is why Task 7 sits after Tasks 1–6 and behind
its own commit — it is the one step whose revert is a single `git revert`.
