# Which Command Answers For The Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every read-only refarm command a verdict on whether its answer depends on the
directory you are standing in, and close every divergence that verdict convicts.

**Architecture:** `scripts/directory-independence.mjs` gains a declared `scope` per command (`node`
or `project`) with a written reason, a fifth observation verdict (`unproven`) so "not measured" stops
reading as "fine", and a judgement matrix that crosses verdict × scope — including the inverse check
that a project-scoped command answering identically everywhere has stopped reading the project. The
burn-down that follows is driven by convictions, never by the site count.

**Tech Stack:** JavaScript ES modules (`scripts/*.mjs`, `node --test`), TypeScript (`apps/refarm`,
`packages/*`, vitest), Commander.

**Spec:** [`docs/superpowers/specs/2026-08-09-which-command-answers-for-the-node-design.md`](../specs/2026-08-09-which-command-answers-for-the-node-design.md)

## Global Constraints

- **Source sovereignty.** Edit `src/` only. Rebuild the package (`pnpm --filter @refarm.dev/<pkg> run
  build`) before `apps/refarm` consumes a change; **rebuild `apps/refarm` before every probe run**,
  because the probe spawns `apps/refarm/dist/index.js` and would otherwise measure the previous
  build.
- **Ratchet.** `node scripts/no-os-resolution.mjs` reports **117, delta 0** today. When a burn-down
  commit removes an offending site, lower `BASELINE_MAX_OFFENDING_SITES` **in the same commit** so
  delta stays 0 — the discipline `d8f850b8` set.
- **The probe is the acceptance test.** No site is touched unless a command's verdict convicts it. A
  site that no command convicts stays, guarded by the ratchet against becoming a *new* default.
- **Time-variance is measured, never declared.** Four invocations differ between two runs in the
  same directory (`resume`, `budget usage`, `project handoff validate`, `inspect`). The control pair
  excludes those fields per FIELD and prints them on every row; do not hand-declare a field the
  control already covers, and never widen a declaration to silence one.
- **Never fix by declaring.** Adding a field path to `allowedVaryingFieldPaths` requires a written
  reason and is counted separately from `same` in every report. A commit that converts a conviction
  into a declaration must say so in its message and explain why the variance is correct.
- **Lanes.** `refarm agent finish --lane after-edit --run --json` before each commit,
  `--lane after-commit` after, `--lane handoffs` after any public JSON change, `--lane before-push`
  before pushing.
- **Read-only rule, now observed rather than promised.** A command may enter `PROBE_COMMANDS` only
  if it mutates nothing. The probe runs every command once per directory PLUS a control run, so a
  mutating entry writes to the operator's real node four times per invocation. `refarm task list`
  is excluded (ISS-091: it rewrites `~/.refarm/sessions/task-session.v1.json` on every read), which
  leaves **35 of the 36 probeable invocations** in scope for Task 3. The probe snapshots the
  sovereign dir around each run and warns, naming the files that changed.
- **No `refarm ask`.** It spends the operator's paid quota.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/directory-independence.mjs` | verdict engine, scope declarations, report | 2, 3 |
| `scripts/directory-independence.test.mjs` | pure-function tests (`node --test`) | 2 |
| `apps/refarm/test/commands/probe-coverage.test.ts` | every leaf command probed or excluded with a reason | 4 |
| `.project/issues.json` | one work item per conviction, filed before the fix | 3 |
| the convicted source files | the burn-down itself, one commit each | 5 |
| `docs/NO_OS_RESOLUTION.md` | the current table, its date, and what CI may claim | 6 |
| `package.json`, `.github/workflows/test.yml` | CI subset wiring | 6 |

---

### Task 1: Re-take the measurements before changing the instrument

**Files:**
- Modify: this plan file (the verdict table below)

**Interfaces:**
- Consumes: nothing.
- Produces: the confirmed candidate list Task 3 turns into `PROBE_COMMANDS`. **Stop gate:** if the
  probeable count differs materially from 36, or if any of the five currently-probed commands has
  changed verdict, stop and add a dated erratum to the spec before continuing.

- [x] **Step 1: Re-take the coverage numbers**

```bash
refarm --help | grep -cE '^  [a-z]'                    # expect 64
node -e 'import("./scripts/directory-independence.mjs").then(m => console.log(m.PROBE_COMMANDS.length))'   # expect 5
pnpm --filter refarm run build && node scripts/directory-independence.mjs   # expect 4 same, 1 differs-as-declared
node scripts/no-os-resolution.mjs                       # expect 117, delta 0
```

- [x] **Step 2: Re-take the probeable list**

Run every candidate from the repository, requiring exit 0 and parseable JSON. The 36 confirmed on
2026-08-09:

```
resume · check --next-action · status · health · doctor · context · model current ·
model providers · plugin status · plugin list · workspace list · connection status ·
budget observations --limit 3 · budget by-workspace · budget by-host · budget by-spawner ·
budget usage · sessions list · task list · issues list --workspace refarm · capabilities ·
agent · runtime status · project handoff validate · process list · delivery list ·
records list · vault list · skill list · extension list · theme list · tree list ·
inspect · surface list · actions · package-manager
```

```bash
for cmd in "resume" "status" "health" "doctor" "context" "agent" "capabilities" "actions" "package-manager" "inspect"; do
  node apps/refarm/dist/index.js $cmd --json >/dev/null 2>&1 && echo "PROBEABLE $cmd" || echo "unrunnable $cmd"
done
```

Extend the loop to the multi-word invocations. **Any candidate that mutates state is excluded here,
not later** — the probe would run it three times per invocation.

- [x] **Step 3: Record the verdicts in this file and commit**

Paste the real numbers into a `## Task 1 measurements` section at the end of this plan. `.superpowers/`
is gitignored (ISS-070), so the tracked plan file is the durable record.

```bash
git add docs/superpowers/plans/2026-08-09-which-command-answers-for-the-node.md
git commit -m "docs(plan): the probe expansion, with task 1's coverage measurements in-tree"
```

---

### Task 2: The verdict observes, the scope judges

**Files:**
- Modify: `scripts/directory-independence.mjs`
- Test: `scripts/directory-independence.test.mjs`

**Interfaces:**
- Consumes: the existing `compareAnswers(byDirectory, declaration)`, `ran`, `unrunnable`.
- Produces:
  - `compareAnswers` returning verdict `"same" | "differs-as-declared" | "differs-undeclared" | "unrunnable-somewhere" | "unproven"`
  - `judge(verdict, scope) → "pass" | "convicted"`
  - `validateDeclarations(commands) → string[]` (empty means every entry is well-formed)
  - `summarise(rows) → { probed, same, declared, convicted, unproven }`

- [x] **Step 1: Write the failing tests**

Append to `scripts/directory-independence.test.mjs`, matching its flat `test(...)` style:

```javascript
import { judge, summarise, validateDeclarations } from "./directory-independence.mjs";

const NODE = { scope: "node", allowedVaryingFieldPaths: [] };
const PROJECT = { scope: "project", allowedVaryingFieldPaths: [] };

test("unrunnable in ALL directories is unproven, not a conviction", () => {
	const result = compareAnswers(
		{ repo: unrunnable("no daemon"), tmp: unrunnable("no daemon"), rcdc5: unrunnable("no daemon") },
		NODE,
	);
	assert.equal(result.verdict, "unproven");
	assert.equal(judge(result.verdict, "node"), "pass");
});

test("unrunnable in SOME directories convicts a node command — the ENOENT shape", () => {
	const result = compareAnswers(
		{ repo: ran({ ok: true }), tmp: unrunnable("ENOENT /tmp/.project/handoff.json"), rcdc5: unrunnable("ENOENT") },
		NODE,
	);
	assert.equal(result.verdict, "unrunnable-somewhere");
	assert.equal(judge(result.verdict, "node"), "convicted");
});

test("the same observation PASSES for a project-scoped command", () => {
	const result = compareAnswers(
		{ repo: ran({ ok: true }), tmp: unrunnable("ENOENT"), rcdc5: unrunnable("ENOENT") },
		PROJECT,
	);
	assert.equal(judge(result.verdict, "project"), "pass");
});

test("INVERSE CHECK: a project command that answers identically everywhere is convicted", () => {
	const result = compareAnswers(
		{ repo: ran({ items: 3 }), tmp: ran({ items: 3 }), rcdc5: ran({ items: 3 }) },
		PROJECT,
	);
	assert.equal(result.verdict, "same");
	assert.equal(judge(result.verdict, "project"), "convicted");
});

test("a node command that differs undeclared is convicted", () => {
	const result = compareAnswers(
		{ repo: ran({ base: "/a" }), tmp: ran({ base: "/b" }), rcdc5: ran({ base: "/c" }) },
		NODE,
	);
	assert.equal(result.verdict, "differs-undeclared");
	assert.equal(judge(result.verdict, "node"), "convicted");
});

test("a declared field path with a reason passes and is counted apart from `same`", () => {
	const declaration = {
		scope: "node",
		allowedVaryingFieldPaths: ["ctx.builtPluginSha"],
		fieldReasons: { "ctx.builtPluginSha": "the built plugin is a fact about the working tree" },
	};
	const result = compareAnswers(
		{ repo: ran({ ctx: { builtPluginSha: "a" } }), tmp: ran({ ctx: { builtPluginSha: "b" } }) },
		declaration,
	);
	assert.equal(result.verdict, "differs-as-declared");
	assert.equal(judge(result.verdict, "node"), "pass");
	assert.deepEqual(summarise([{ ...result, scope: "node" }]), {
		probed: 1, same: 0, declared: 1, convicted: 0, unproven: 0,
	});
});

test("validateDeclarations rejects a declared path with no reason", () => {
	const errors = validateDeclarations([
		{ name: "x", argv: ["x"], scope: "node", scopeReason: "r", allowedVaryingFieldPaths: ["a.b"] },
	]);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /a\.b/);
});

test("validateDeclarations rejects a command with no scope — there is no default", () => {
	const errors = validateDeclarations([{ name: "x", argv: ["x"], allowedVaryingFieldPaths: [] }]);
	assert.match(errors[0], /scope/);
});

test("every shipped PROBE_COMMANDS entry is well-formed", () => {
	assert.deepEqual(validateDeclarations(PROBE_COMMANDS), []);
});
```

- [x] **Step 2: Run and watch them fail**

```bash
node --test scripts/directory-independence.test.mjs
```
Expected: `judge is not a function`, plus the `unproven` assertions failing (today every unrunnable
directory yields `"unrunnable"`).

- [x] **Step 3: Split the unrunnable branch**

In `compareAnswers` (`scripts/directory-independence.mjs:153`), replace the early return:

```javascript
	const labels = Object.keys(byDirectory);
	const unrunnableDirectories = labels.filter((label) => byDirectory[label].status === "unrunnable").sort();
	// THREE STATES where there were two. Failing EVERYWHERE is the environment (no daemon, no
	// sandbox, a fixture this probe does not have) and proves nothing — it must never be summed
	// into `same`, which is the exact defect that let a 5-of-64 surface read as measured. Failing
	// in SOME directories is the finding itself: it is the shape of `ENOENT /tmp/.project/...`.
	if (unrunnableDirectories.length === labels.length) {
		return { verdict: "unproven", fieldPaths: [], unrunnableDirectories };
	}
	if (unrunnableDirectories.length > 0) {
		return { verdict: "unrunnable-somewhere", fieldPaths: [], unrunnableDirectories };
	}
```

- [x] **Step 4: Add the judgement matrix and the declaration guard**

```javascript
/** PURE. The verdict says what was OBSERVED; the scope says what that observation MEANS. Keeping
 * them in one field is what forced this probe to treat every difference as a defect, which is why
 * it could never grow past commands that must be identical. A `project` command is expected to vary
 * by directory — and the row that earns this split is `same` under `project`: a project-local
 * command answering identically from /tmp has stopped reading the project and is answering from the
 * node. Same inverse check `refarm parity` applies to its ISOLATING_AXES table. */
export function judge(verdict, scope) {
	if (scope === "project") {
		return verdict === "same" ? "convicted" : "pass";
	}
	if (verdict === "differs-undeclared" || verdict === "unrunnable-somewhere") return "convicted";
	return "pass";
}

/** PURE. Every entry must declare its scope with a reason, and every allowed varying field path
 * must name why it varies. Without this the operator's chosen exit criterion — zero convictions —
 * is reachable by declaring divergence instead of closing it, and the green would be
 * indistinguishable from a fixed surface. Returns one message per problem; empty means well-formed. */
export function validateDeclarations(commands) {
	const errors = [];
	for (const command of commands) {
		if (command.scope !== "node" && command.scope !== "project") {
			errors.push(`${command.name}: scope must be "node" or "project" (there is no default)`);
		}
		if (!command.scopeReason?.trim()) errors.push(`${command.name}: scope needs a written reason`);
		for (const fieldPath of command.allowedVaryingFieldPaths ?? []) {
			if (!command.fieldReasons?.[fieldPath]?.trim()) {
				errors.push(`${command.name}: declared varying path ${fieldPath} has no reason`);
			}
		}
	}
	return errors;
}

/** PURE. Four counts plus the total, never one number. `declared` is NOT folded into `same`: zero
 * convictions with five reasoned declarations and zero convictions with forty are different states
 * of the same surface, and the operator reads which he has. */
export function summarise(rows) {
	return {
		probed: rows.length,
		same: rows.filter((row) => row.verdict === "same" && row.scope !== "project").length,
		declared: rows.filter((row) => row.verdict === "differs-as-declared").length,
		convicted: rows.filter((row) => judge(row.verdict, row.scope) === "convicted").length,
		unproven: rows.filter((row) => row.verdict === "unproven").length,
	};
}
```

- [x] **Step 5: Carry `scope` through `runProbe`, the table and `main`**

- `runProbe` returns `{ name, scope, ...result, byDirectory }`.
- `formatProbeTable` gains a Judgement column and prints `scope`, plus the reason on a declared or
  unproven row — a report that shows a reason next to every non-`same` row is what stops the escape
  hatch being invisible.
- `main()` runs `validateDeclarations(PROBE_COMMANDS)` **first** and exits non-zero on any message
  before probing anything; then prints `summarise(rows)` as the one-line summary from the spec; then
  exits non-zero when `convicted > 0`. `unproven > 0` does **not** fail the run, and the summary line
  states it explicitly.

- [x] **Step 6: Run everything**

```bash
node --test scripts/directory-independence.test.mjs
pnpm --filter refarm run build && node scripts/directory-independence.mjs
```
Expected: the five existing commands keep their verdicts (`workspace list`, `model current`,
`plugin status`, `connection status` = same; `context` = differs-as-declared) once each gains
`scope: "node"` with a reason and `context`'s four paths gain theirs — lift those reasons from the
comment already at `directory-independence.mjs:189-200`, which explains them in prose.

- [x] **Step 7: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add scripts/directory-independence.mjs scripts/directory-independence.test.mjs
git commit -m "feat(probe): the verdict observes and the scope judges, and not-measured stops reading as fine"
refarm agent finish --lane after-commit --run --json
```

---

### Task 3: Probe the whole read-only surface, and file what it convicts

**Files:**
- Modify: `scripts/directory-independence.mjs` (`PROBE_COMMANDS`: 5 → 36)
- Modify: `.project/issues.json` (via `refarm issues add` only)
- Modify: this plan file (one burn-down sub-task per conviction)

**Interfaces:**
- Consumes: Task 2's engine.
- Produces: **the conviction list.** Everything after this task is sized by it.

- [x] **Step 1: Declare all 36, each with a scope and a reason**

Every entry states what it speaks about. The classification is the deliverable; write the reason as
a sentence a reader can disagree with, not a label:

```javascript
{
	name: "resume",
	argv: ["resume", "--json"],
	scope: "node",
	scopeReason: "The slice entry point reports the NODE's runtime, model route, session and ledger; where the operator stands must not change any of it.",
	allowedVaryingFieldPaths: [],
},
{
	name: "project handoff validate",
	argv: ["project", "handoff", "validate", "--json"],
	scope: "project",
	scopeReason: "refarm project resolves .project/ relative to the working directory BY DESIGN; refusing outside a project is the correct answer, and answering the same everywhere would mean it stopped reading the project.",
	allowedVaryingFieldPaths: [],
},
{
	name: "issues list --workspace refarm",
	argv: ["issues", "list", "--workspace", "refarm", "--json"],
	scope: "node",
	scopeReason: "The ledger is addressed through the node's declared catalog; the 2026-08-08 slice proved this identical from three directories and this entry is the regression guard for that proof.",
	allowedVaryingFieldPaths: [],
},
```

For each of the remaining 33, decide `node` or `project` from what the command reads, not from its
name. **When the honest answer is 'unclear', mark it `node` and say so in the reason** — a node
command that turns out to be project-local will be convicted by the inverse of what you expected,
which is information; the reverse silently excuses a leak.

- [x] **Step 2: Run the full probe and capture the table**

```bash
pnpm --filter refarm run build
node scripts/directory-independence.mjs | tee /tmp/probe-run-1.txt
```

Expected shape (**not** a prediction of the numbers):
```
directory-independence: 36 probed · N same · N declared · N convicted · N unproven
```

- [x] **Step 3: File one work item per conviction, before fixing anything**

```bash
refarm issues add --workspace refarm --axis node-vs-directory --category issue --priority high \
  --package apps/refarm --location "<file>:<line>" --id ISS-0XX \
  --title "<command> answers differently depending on the directory: <field paths>" \
  --body "Convicted by scripts/directory-independence.mjs on 2026-08-09. Verdict: differs-undeclared. Diverging field paths: … Directories: … Declared scope: node, because … The call site is …" \
  --json
```

The record exists **before** the fix so that an abandoned fix leaves a named item rather than
nothing. If a conviction turns out to be a mis-declared scope rather than a defect, the item is
resolved with the corrected declaration as its `resolved_by`.

- [x] **Step 4: Turn the conviction list into sub-tasks in this plan**

Append to Task 5 one `- [ ] **5.N: <command> — <field paths>**` line per conviction, ordered by how
early the command appears in the daily loop (`resume`, `check`, `doctor`, `health`, `status`,
`context`, `workspace`, `connection`, `budget`, `sessions`, `issues`, then the rest). The plan stops
being unbounded the moment this step lands.

- [x] **Step 5: Commit the measurement**

```bash
refarm agent finish --lane after-edit --run --json
git add scripts/directory-independence.mjs .project/issues.json docs/superpowers/plans/2026-08-09-which-command-answers-for-the-node.md
git commit -m "feat(probe): 36 commands measured from three directories, and every conviction filed"
refarm agent finish --lane after-commit --run --json
```

---

### Task 4: The coverage stops rotting

**Files:**
- Create: `apps/refarm/test/commands/probe-coverage.test.ts`
- Create: `scripts/directory-independence-exclusions.mjs`

**Interfaces:**
- Consumes: `PROBE_COMMANDS`, the Commander program from `apps/refarm/src/program.ts`.
- Produces: `PROBE_EXCLUSIONS: Array<{ argv: string[], reason: string }>`.

- [x] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { PROBE_COMMANDS } from "../../../../scripts/directory-independence.mjs";
import { PROBE_EXCLUSIONS } from "../../../../scripts/directory-independence-exclusions.mjs";
import { program } from "../../src/program.js";

/** Every leaf command in the CLI, as `["budget", "by-host"]`. A command with subcommands is not a
 *  leaf: `budget` alone is a namespace, `budget by-host` is the thing that answers. */
function leafCommands(command: any, prefix: string[] = []): string[][] {
	const children = command.commands ?? [];
	if (children.length === 0) return prefix.length > 0 ? [prefix] : [];
	return children.flatMap((child: any) => leafCommands(child, [...prefix, child.name()]));
}

describe("probe coverage", () => {
	const leaves = leafCommands(program);
	const probed = new Set(PROBE_COMMANDS.map((c: any) => c.argv.filter((a: string) => !a.startsWith("--")).join(" ")));
	const excluded = new Set(PROBE_EXCLUSIONS.map((e: any) => e.argv.join(" ")));

	it("finds the CLI's leaf commands at all", () => {
		expect(leaves.length).toBeGreaterThan(50);
	});

	it("has every leaf command either probed or excluded with a written reason", () => {
		const uncovered = leaves
			.map((leaf) => leaf.join(" "))
			.filter((name) => !probed.has(name) && !excluded.has(name));
		expect(uncovered).toEqual([]);
	});

	it("refuses an exclusion with no reason", () => {
		for (const exclusion of PROBE_EXCLUSIONS as any[]) {
			expect(exclusion.reason?.trim()?.length ?? 0).toBeGreaterThan(0);
		}
	});
});
```

- [x] **Step 2: Run and watch it fail**

```bash
pnpm --filter refarm exec vitest run test/commands/probe-coverage.test.ts
```
Expected: a long `uncovered` array — that array **is** the honest coverage gap, and printing it is
the point.

- [x] **Step 3: Write the exclusions, each with a reason**

```javascript
/** Commands deliberately outside the directory-independence probe. Every entry needs a reason:
 * silence is how a probe reaches 5-of-64 coverage without anyone choosing it. */
export const PROBE_EXCLUSIONS = [
	{ argv: ["runtime", "restart"], reason: "MUTATES: the probe runs each command three times." },
	{ argv: ["ask"], reason: "MUTATES and spends the operator's paid quota." },
	{ argv: ["config", "profile"], reason: "Needs a <name> argument; no fixture. Probeable once one exists." },
	{ argv: ["parity"], reason: "Needs the sandbox node running; would be `unproven` on every run." },
	{ argv: ["telemetry"], reason: "No read-only --json reader exists. Filed as a work item." },
	// … one line per remaining leaf command …
];
```

- [x] **Step 4: Run until green, then commit**

```bash
pnpm --filter refarm exec vitest run test/commands/probe-coverage.test.ts
refarm agent finish --lane after-edit --run --json
git add apps/refarm/test/commands/probe-coverage.test.ts scripts/directory-independence-exclusions.mjs
git commit -m "feat(probe): a new command must be probed or excluded with a reason"
refarm agent finish --lane after-commit --run --json
```

---

### Task 5: The burn-down — one commit per conviction

**Files:** decided by Task 3. Sub-tasks are appended there.

**Interfaces:**
- Consumes: the conviction list and its work items.
- Produces: `convicted == 0`.

**The conviction list, measured 2026-08-10.** 35 probed · 26 same · 1 declared · **4 convicted** ·
0 unproven. This plan stops being unbounded here.

- [ ] **5.1 — `resume`, ISS-092 (critical).** Sixteen `project.*` paths. From `/tmp` it returns
  `ok: true` with an empty project block and `truncation: null`. The entry point CLAUDE.md mandates
  at every slice start cannot distinguish "no work" from "no project read". Fix shape: three states
  in the project block, never two.
- [ ] **5.2 — `doctor`, ISS-093 (high).** `host.packageManager` is `pnpm` here and `npm` from both
  other directories, and seven downstream advice fields follow it. `packages/config/src/package-manager.js`
  holds the ratchet's largest cluster (10 sites) and this is the first time it is tied to a wrong
  answer rather than a shape count.
- [ ] **5.3 — `plugin list`, ISS-094 (high).** The node's own plugin reports `packageSource:
  "unresolved"`, `packageDir: null` from anywhere else, while `plugin status` is correctly identical
  — so the node knows, and `list` re-derives.
- [ ] **5.4 — `surface list`, ISS-095 (high).** Reads `<cwd>/.refarm/config.json`: 3 surfaces here, 0
  from `/tmp`. The gitignored dev-fixture defect the 2026-08-07 slice named, still live in another
  command.

Not convicted, and worth stating because a passing row is a claim too: the four `project`-scoped
commands (`check --next-action`, `health`, `project handoff validate`, `package-manager`) pass —
three by refusing or differing outside their project, which is what the inverse check demands.
`budget usage`, `inspect` and `resume` carry time-variant fields the control pair excluded.

**Per-conviction procedure.** For each sub-task, in daily-loop order:

- [ ] **Step 1: Read the call site before deciding anything**

`grep -n "process.cwd()" <file>` and read the surrounding function. Answer one question in writing,
in the commit message: **did this site want the node, or the directory?**
- Wanted the node → replace with `declaredBase()` from `@refarm.dev/config` (never `?? process.cwd()`
  — that is the shape the ratchet counts).
- Wanted the directory → the site is correct and the **declaration** was wrong: change the command's
  `scope` to `project`, or add the field path to `allowedVaryingFieldPaths` with a reason.

Both outcomes are legitimate. On the 2026-08-07 slice, eight of ten shape-selected sites turned out
to want the cwd correctly — a burn-down that assumes every site is a bug will break working commands.

- [ ] **Step 2: Fix or declare, then re-probe that one command**

```bash
pnpm --filter refarm run build
node -e '
import("./scripts/directory-independence.mjs").then(async (m) => {
  const one = m.PROBE_COMMANDS.filter((c) => c.name === "<command>");
  console.log(m.formatProbeTable(m.runProbe(one)));
});
'
```
Expected: that row moves `convicted → pass`.

- [ ] **Step 3: Close the item with the verdict as evidence**

```bash
refarm issues set-status --workspace refarm --id ISS-0XX --status resolved --resolved-by <commit-sha>
```

- [ ] **Step 4: Commit, with the before/after verdict in the message**

```bash
node scripts/no-os-resolution.mjs   # if a site left the scan, lower the ceiling in THIS commit
refarm agent finish --lane after-edit --run --json
git add -A && git commit -m "fix(<area>): <command> answers for the node from any directory

Probe verdict: differs-undeclared -> same. Diverging paths were: …
The site wanted <the node|the directory>, because …"
refarm agent finish --lane after-commit --run --json
```

---

### Task 6: What CI may claim, and the record

**Files:**
- Modify: `package.json` (scripts), `.github/workflows/test.yml`
- Modify: `docs/NO_OS_RESOLUTION.md`, `.project/handoff.json`

- [ ] **Step 1: Split the probe into a CI subset**

Add `--ci` to `main()`: it runs only entries marked `ciSafe: true` (those needing no daemon and no
second workspace), and prints the coverage fraction **in the summary line**:

```
directory-independence [--ci]: 14 of 36 probed (22 unproven in CI) · 14 same · 0 convicted
CI green means the subset CI could measure is directory-independent. It does not mean the surface is.
```

That second line is printed by the tool, not only written in a spec — a report that can be read as a
stronger claim than it earned is the defect this whole slice is about.

- [ ] **Step 2: Wire it**

`package.json`: `"directory-independence:ci": "node scripts/directory-independence.mjs --ci"`. Add it
to the workflow beside the existing `project-block-consistency` step, with a minimal, targeted diff —
`.github/workflows/**` is a CLAUDE.md §8 protected surface, so no re-indentation and no re-ordering.

- [ ] **Step 3: Record the table with its date**

Add to `docs/NO_OS_RESOLUTION.md`: the full local run's table, the date it was taken, the summary
line, and the sentence that the local run is the authority. Replace the current five-row table rather
than appending a second one — two tables of the same measurement is the drift this repo keeps paying
for.

- [ ] **Step 4: Rewrite the handoff and gate**

`.project/handoff.json`'s `current_tasks` head entry becomes the slice narrative **citing ids**; every
`next_actions` and `blockers` entry must still cite at least one existing id or the gate blocks.

- [ ] **Step 5: Full gate and push**

```bash
node scripts/ci/project-block-consistency.mjs
node scripts/directory-independence.mjs        # convicted == 0
node scripts/no-os-resolution.mjs              # delta 0
refarm agent finish --lane before-push --run --json
```

---

## Self-review

**Spec coverage.** Scope declaration + reasons → Task 2 Steps 4–5. The five verdicts and the
judgement matrix → Task 2 Steps 3–4. Three numbers → `summarise`, Task 2 Step 4. Coverage ratchet →
Task 4. CI policy and the "green means the subset" sentence → Task 6 Step 1. The burn-down and its
exit criterion → Tasks 3 and 5. The named non-goals (no new `--json` readers, no fixture probing)
become exclusion entries with reasons in Task 4 Step 3 and work items in Task 3 Step 3.

**Type consistency.** `judge(verdict, scope)` takes the verdict string and the scope string in that
order everywhere (Task 2 tests, `summarise`, `formatProbeTable`, `main`). `runProbe` rows carry
`scope`, which `summarise` and `judge` both read. `validateDeclarations` takes the command array and
returns `string[]`; `main` calls it before probing.

**Known risk, named rather than discovered.** Task 3's classification of 36 commands into `node` and
`project` is the judgement-heavy step, and a wrong call there produces a wrong verdict rather than a
crash. The mitigation is directional and stated in Step 1: when unclear, declare `node`. A wrongly
`node`-declared project command gets convicted and is corrected with evidence; a wrongly
`project`-declared node command is silently excused, which is the failure this slice exists to end.

**Unbounded until Task 3, and bounded after it.** Task 5 has no sub-tasks written yet, by
construction — the number of convictions is unknown until the probe runs. Task 3 Step 4 is the step
that converts this plan from open-ended to countable, and it is not optional.

---

## Task 1 measurements

Taken 2026-08-09 on the operator's node (`sede`), against `26b618c4`. `.superpowers/sdd/` is
gitignored (ISS-070), so this section — not a report file — is the durable record.

### Coverage, re-taken

| Measurement | Command | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- |
| Top-level commands | `refarm --help \| grep -cE '^  [a-z]'` | 64 | **64** | CONFIRMED |
| Commands probed today | `PROBE_COMMANDS.length` | 5 | **5** | CONFIRMED |
| Ratchet | `node scripts/no-os-resolution.mjs` | 117, delta 0 | **117, delta 0** | CONFIRMED |
| Probeable invocations | 36 candidates, exit 0 + parseable JSON | 36 | **36/36** | CONFIRMED |

### The five currently probed, unchanged

```
| Command             | Verdict             | Notes                                              |
| workspace list      | same                |                                                    |
| model current       | same                |                                                    |
| plugin status       | same                |                                                    |
| context             | differs-as-declared | builtPluginPath, builtPluginSha, divergences,       |
|                     |                     | otherSovereignDirs                                 |
| connection status   | same                |                                                    |
```

Probed from `repo=/home/s095407044/github/refarm`, `tmp=/tmp`, `rcdc5=/home/s095407044/git/rcdc5`.

### The 36 confirmed probeable

All 36 returned exit 0 with parseable JSON from the repository, after
`pnpm --filter refarm run build`:

```
resume · check --next-action · status · health · doctor · context ·
model current · model providers · plugin status · plugin list · workspace list ·
connection status · budget observations --limit 3 · budget by-workspace ·
budget by-host · budget by-spawner · budget usage · sessions list · task list ·
issues list --workspace refarm · capabilities · agent · runtime status ·
project handoff validate · process list · delivery list · records list · vault list ·
skill list · extension list · theme list · tree list · inspect · surface list ·
actions · package-manager
```

**Stop gate: PASSED.** No measurement diverged, so no erratum is owed to the spec and Task 2 may
proceed as written.

### What this run adds that the spec did not have

The 36 were confirmed **against a fresh build**. The spec's recon ran against whatever `dist/` held
at the time; this run rebuilt first, which matters because the probe spawns
`apps/refarm/dist/index.js` — a stale `dist/` would have measured the previous build and the plan's
own Global Constraints now say so.

Two candidates worth naming for Task 3, because their scope is not obvious from the name and the
plan's directional rule ("when unclear, declare `node`") will be doing real work on them:

- `project handoff validate` — runs here, and the ledger slice already measured it ENOENT-ing from
  `/tmp` and `~/git/rcdc5`. Expected `scope: "project"`, and it is the entry that proves the inverse
  check has something to check.
- `issues list --workspace refarm` — the same family of document, addressed through the node's
  catalog instead of the cwd. Expected `scope: "node"`, and its verdict is the regression guard for
  the proof the 2026-08-08 slice took by hand.
