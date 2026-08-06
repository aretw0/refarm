# The Node Answers For Itself — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `refarm context` report the NODE's sovereign state instead of the CLI's, and surface it when the two disagree.

**Architecture:** The daemon's own `/proc/<pid>/environ` and `/proc/<pid>/cwd` are a readable witness to what it actually resolved. Read them, report the node's values, and compare against what the CLI stack resolves — the divergence clause ADR-094 specifies and nothing implements.

**Tech Stack:** TypeScript (`apps/refarm`, `packages/config`, vitest). No Rust, no WASM rebuild.

**Spec:** `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` — D2's third clause, plus three follow-ups the cockpit plan named and deferred.

## The defect, reproduced rather than argued

`refarm context` exists to answer which sovereign state is active. Run from a directory that is not the daemon's, it answers with the CLI's. Measured 2026-08-06 on node `sede`:

```
$ cd ~/git/rcdc5 && refarm context
  base: /home/s095407044/git/rcdc5  (from cwd)          ← the CLI's cwd
  namespace: default
  node: sede [f17151b4]  pid 2948186  started …          ← the daemon

$ readlink /proc/2948186/cwd
/home/s095407044/github/refarm                            ← the daemon's actual base
```

The `base:` line sits directly above the `node:` line and reads as the node's. It is not. The daemon declares no `SOVEREIGN_BASE` at all — verified from its own environ — so it falls back to the directory `tractor-start.sh` ran from, while the CLI falls back to wherever the operator is standing.

They agree on this machine right now only because the daemon happens to have been started from the repository. That coincidence is the whole problem: the answer looks stable and is not.

This is the same class as the defect the cockpit plan fixed — a reconstruction where a witness exists — appearing inside the instrument built to end that class. It is also precisely the 2026-08-03 field failure's shape: a base resolved against where a process stands rather than what it was told.

The witness is readable. `/proc/<pid>/environ` is mode `0400`, same uid, and on this node it carries:

```
REFARM_HOME=/home/s095407044/.refarm
SOVEREIGN_DIR=.refarm
```

with `SOVEREIGN_BASE` and `REFARM_NAMESPACE` both ABSENT — which is itself a fact worth reporting, because absent means the node fell back rather than being told.

## Global Constraints

- **Report the node's state; the CLI's is a second fact, not the answer.** Where they differ, say so. Where the node cannot be read, say that — never silently substitute the CLI's value.
- **Three states, never two.** A witness that cannot be read is `unknown`, not "same as ours". This line of work has produced eight instances of two-states-where-three-belong; assume this plan is exposed to it too.
- **Never guess when a witness exists.** That rule is why the cockpit reads the running process's `--plugin` argument rather than reconstructing a path, and it applies identically here.
- **Read-only.** `refarm context` never writes and never restarts. A restart interrupts what the node is serving and is the operator's decision.
- **Pure core, impure edge.** Filesystem and `/proc` reads happen at the command edge; comparison and reporting are pure and driven by literals in tests.
- `apps/refarm` is TypeScript with `.js` import specifiers in relative imports. No cargo commands are needed; never run a bare `cargo test` in this repo regardless.
- Do not run `pnpm run diagrams:fix` — it regenerates 42 diagrams and this machine's browser differs from CI's, dirtying ~35 unrelated SVGs. If a diagram becomes false, say so and fix that one with the known workaround rather than leaving it wrong.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/refarm/src/utils/node-environment.ts` | **New.** Read a running node's own environ and cwd. | 1 |
| `apps/refarm/src/utils/node-environment.test.ts` | **New.** Parsing and the three states. | 1 |
| `apps/refarm/src/commands/context.ts` | Report the node's values; add the divergence kinds. | 2 |
| `apps/refarm/src/commands/sovereign-divergence-doctor.ts` | Surface them in `refarm doctor`. | 3 |
| `packages/config/src/index.js` + `.d.ts` | Export the workspace-root marker predicate. | 4 |
| `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` | Record D2's third clause as delivered. | 5 |

---

### Task 1: Read what the node was told

**Files:**
- Create: `apps/refarm/src/utils/node-environment.ts`
- Test: `apps/refarm/src/utils/node-environment.test.ts`

**Interfaces:**
- Produces:
  - `export interface NodeEnvironment { base: string | null; sovereignDir: string | null; home: string | null; namespace: string | null; cwd: string | null }`
  - `export function parseProcEnviron(raw: string): Record<string, string>`
  - `export function resolveNodeEnvironment(pid: number, deps?: NodeEnvironmentDeps): NodeEnvironment | null`

`null` on a FIELD means the node declares that variable nowhere — a real finding, since it means the node fell back rather than being told. `null` from the FUNCTION means the process could not be read at all. Those are different and must not collapse.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseProcEnviron, resolveNodeEnvironment } from "./node-environment.js";

describe("parseProcEnviron", () => {
	it("parses the NUL-separated shape /proc actually produces", () => {
		expect(parseProcEnviron("REFARM_HOME=/home/op/.refarm\0SOVEREIGN_DIR=.refarm\0")).toEqual({
			REFARM_HOME: "/home/op/.refarm",
			SOVEREIGN_DIR: ".refarm",
		});
	});

	it("keeps a value containing '=' whole", () => {
		expect(parseProcEnviron("K=a=b\0")).toEqual({ K: "a=b" });
	});

	it("ignores an entry with no '=' rather than inventing an empty value", () => {
		expect(parseProcEnviron("BROKEN\0K=v\0")).toEqual({ K: "v" });
	});

	it("returns an empty object for empty input", () => {
		expect(parseProcEnviron("")).toEqual({});
	});
});

describe("resolveNodeEnvironment", () => {
	const deps = {
		readEnviron: () => "REFARM_HOME=/home/op/.refarm\0SOVEREIGN_DIR=.refarm\0",
		readCwd: () => "/home/op/github/refarm",
	};

	it("reports what the node declares", () => {
		const env = resolveNodeEnvironment(42, deps);
		expect(env?.home).toBe("/home/op/.refarm");
		expect(env?.sovereignDir).toBe(".refarm");
		expect(env?.cwd).toBe("/home/op/github/refarm");
	});

	it("an undeclared variable is null — the node fell back, which is a finding", () => {
		const env = resolveNodeEnvironment(42, deps);
		expect(env?.base).toBeNull();
		expect(env?.namespace).toBeNull();
	});

	it("returns null when the process cannot be read at all — different from a null field", () => {
		expect(resolveNodeEnvironment(42, { ...deps, readEnviron: () => null })).toBeNull();
	});

	it("an unreadable cwd leaves cwd null without discarding the environ", () => {
		const env = resolveNodeEnvironment(42, { ...deps, readCwd: () => null });
		expect(env).not.toBeNull();
		expect(env?.cwd).toBeNull();
		expect(env?.home).toBe("/home/op/.refarm");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/utils/node-environment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Follow `apps/refarm/src/utils/loaded-plugin.ts` exactly — it solves the same problem for `/proc/<pid>/cmdline` and already establishes the shape: a pure parser, an injectable reader, `try`/`catch` returning `null` rather than throwing. Reuse its idiom rather than inventing a second one. `/proc/<pid>/environ` is NUL-separated with a trailing NUL, like `cmdline`.

Read the variable names from `@refarm.dev/config`'s exported constants (`SOVEREIGN_BASE_KEY`, `SOVEREIGN_DIR_SELECTOR_KEY`) rather than re-typing the strings, so the CLI and the node cannot drift about which variable means what.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @refarm.dev/refarm exec vitest run src/utils/node-environment.test.ts
pnpm --filter @refarm.dev/refarm run type-check
git add apps/refarm/src/utils/node-environment.ts apps/refarm/src/utils/node-environment.test.ts
git commit -m "feat(context): read what the node itself was told"
```

---

### Task 2: `refarm context` answers for the node

**Files:**
- Modify: `apps/refarm/src/commands/context.ts`
- Test: `apps/refarm/src/commands/context.test.ts`

**Interfaces:**
- Consumes: `resolveNodeEnvironment` from Task 1.
- Produces: `ContextInput` gains the node's own resolved values; `DivergenceKind` gains `base-divergence`, `namespace-divergence` and `node-environment-unknown`.

- [ ] **Step 1: Write the failing test**

Cover: the node and the CLI agreeing (no divergence); the node's base differing from the CLI's (`base-divergence`, naming BOTH values); the node's namespace differing (`namespace-divergence`); the node's environ unreadable while the node is running (`node-environment-unknown`, and NOT a base divergence, since nothing is known to differ); and a node that is not running (unchanged — `node-not-running`, no environment divergence).

The `node-environment-unknown` case is the one most likely to be got wrong: an unreadable witness must not silently fall back to comparing the CLI against itself and reporting agreement.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

The reported `base` and `namespace` become the NODE's. Where the node declares nothing, say so — "not declared; the node fell back to its own working directory" is the honest phrasing, and `/proc/<pid>/cwd` is what it fell back TO, so report that too.

Keep the CLI's own values in the report as a second, clearly labelled fact. The operator needs both to understand a divergence; what he must not get is one presented as the other.

- [ ] **Step 4: Verify, then run it live from two directories**

```bash
pnpm --filter @refarm.dev/refarm exec vitest run src/commands/context.test.ts
pnpm --filter @refarm.dev/refarm run test
pnpm --filter @refarm.dev/refarm run build
refarm context
cd ~/git/rcdc5 && refarm context ; cd -
```

Expected: from the repository, agreement. From `~/git/rcdc5`, a `base-divergence` naming both paths — the defect this task exists to close, now reported instead of hidden. Paste both outputs.

- [ ] **Step 5: Commit.**

---

### Task 3: The divergences reach `refarm doctor`

**Files:**
- Modify: `apps/refarm/src/commands/sovereign-divergence-doctor.ts` and its test

The cockpit plan established the pattern and the exhaustiveness guard: a new `DivergenceKind` without a case is a compile error. So Task 2 will already have forced this file to change. This task makes the new kinds produce findings rather than a bare `assertNever` satisfaction.

Also close the fourth follow-up here: `node-not-running` is currently silent because `runtime:not-ready` covers the common case. The two are structurally different signals — one reads `node.json` and a pid, the other probes the sidecar over HTTP — so a stale descriptor beside a reachable sidecar is reported by neither. Emit a finding for THAT combination specifically, not for the common case that would double-name.

Follow `runtime-freshness-doctor.ts`: `warning` severity, an `action` that names a command and stops, silence when there is nothing to say.

- [ ] Write the failing tests, run, implement, verify, run `refarm doctor --json` live, commit.

---

### Task 4: The marker predicate stops being duplicated

**Files:**
- Modify: `packages/config/src/index.js` and `packages/config/src/index.d.ts`
- Modify: `apps/refarm/src/commands/context.ts`

`context.ts`'s `defaultHasMonorepoMarker` duplicates the private `hasWorkspaceRootMarker` in `packages/config/src/workspace.js`. Two copies of "what makes a directory a workspace root" drift apart silently.

Export the predicate from `@refarm.dev/config`, have `context.ts` import it, and delete the copy. Rebuild the config package so the type declaration is available: `pnpm --filter @refarm.dev/config run build`.

- [ ] Write a test pinning the exported predicate's behaviour, run, implement, delete the duplicate, verify both packages type-check, commit.

---

### Task 5: Record the clause as delivered

**Files:** Modify `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md`

D2's third clause — "when the TypeScript stack and the Rust host would resolve different homes" — was named as undelivered in that spec. Record that it is delivered, how, and with the measurement: the daemon declares no `SOVEREIGN_BASE`, so it falls back to its own working directory, and before this plan `refarm context` reported the CLI's instead.

Record what remains: the comparison reads the daemon's environ, which is a Linux `/proc` fact — on a platform without `/proc` the witness is unavailable and the answer is `node-environment-unknown` rather than wrong. Say that plainly rather than letting a reader assume portability.

- [ ] Update, verify no other claim in that spec went stale, commit.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| The node's own base/namespace/home are read from its environ | 1 |
| An undeclared variable is distinguishable from an unreadable process | 1 |
| `refarm context` reports the NODE's values | 2 |
| The CLI's values remain visible as a second labelled fact | 2 |
| Base and namespace divergences reported, naming both sides | 2 |
| An unreadable witness is `unknown`, never assumed agreement | 2 |
| Divergences reach `refarm doctor` | 3 |
| The `node-not-running` cross-signal gap closed without double-naming | 3 |
| The marker predicate has one definition | 4 |
| ADR-094 D2's third clause recorded as delivered, with its platform limit | 5 |

**Known follow-up, out of scope:** the loose-ends queue in `.project/handoff.json` carries ten items from earlier plans; none is touched here.
