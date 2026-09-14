# Two Halves, One Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TypeScript stack resolve the node's declaration base the way the Rust host already does, so the two halves of one node stop disagreeing by construction.

**Architecture:** `declaredBase()` stops falling back to the current working directory and falls back the way `dirs_sovereign_base()` does — from `REFARM_HOME`, else the OS home. The `cwd` parameter goes away entirely, because after this there is no path that uses it.

**Tech Stack:** JavaScript (`packages/config`, JS-Atomic), TypeScript (`apps/refarm`, vitest). No Rust changes, no WASM rebuild.

## This is not choosing a nicer default

`packages/config/src/index.js:134-138` already states the guarantee:

> the neutral env var that names WHERE this node's declarations live … injected the same way and read identically by the Rust host and this stack, **so the two cannot answer from different directories on the same node**.

For the fallback case that sentence is false, and has been. Measured 2026-08-06:

| | Resolves the base as |
| --- | --- |
| Rust host (`main.rs:431-446`, `run_daemon`, via `dirs_sovereign_base().parent()` at `main.rs:760-776`) | `dirname(REFARM_HOME)`, else the OS home dir — **never cwd** |
| TypeScript (`packages/config/src/index.js:150-153`, `declaredBase`) | `SOVEREIGN_BASE`, else **`process.cwd()`** |

So the two halves disagree whenever `SOVEREIGN_BASE` is unexported in a shell, which is the ordinary case. This is the root cause of the divergence the cockpit spent a day learning to report: `refarm context` on this machine reports `sovereign:base-divergence` from every directory, and it is right to — the disagreement is real, and it is built in rather than configured.

The consequence measured on the operator's own machine, before `SOVEREIGN_BASE` was declared for the node: `refarm workspace list --json` returned an EMPTY catalog from `~/git/rcdc5` and from `/tmp`, because `loadDeclaredWorkspaces` passes `declaredBase()` as an explicit root and there is no walk-up. His own workspaces were invisible from inside one of them.

**The operator decided this on 2026-08-06**, and the reasoning is preserved here so nobody re-litigates it: the 2026-08-03 field failure was about inferring from WHERE A PROCESS STANDS, and the OS home is not positional — it does not change when he walks. So this honours that correction rather than undoing it. He also said refarm "was born yesterday" for him and he does not mind breaking things to build better long-term, which removes the only thing that had been holding it: caution about a load-bearing default.

## The resolution, mirroring the Rust host

```
SOVEREIGN_BASE set  →  use it
REFARM_HOME set     →  dirname(REFARM_HOME)
otherwise           →  the OS home directory
```

`REFARM_HOME` is honoured so a container declaring `REFARM_HOME=/srv/node/.refarm` gets `/srv/node`, exactly as the Rust host does. The final step is the bare home rather than `home/<SOVEREIGN_DIR>` because `sovereignDir()` in this package **throws** when the selector is unset — deliberately, so no brand name is ever assumed — and a base resolver must not throw.

## Global Constraints

- **The `cwd` parameter is REMOVED, not defaulted.** Leaving it would let a caller re-introduce positional resolution silently, which is the whole defect. If some caller genuinely needs "resolve from where I am standing", that is a different question with a different answer — `resolveRefarmScopeRoot` in `apps/refarm/src/utils/refarm-home.ts` already answers it, including the workspace-sidecar case.
- **Audit every call site before changing the behaviour, not after.** There are 24 across six files. For each, state whether it wanted the node's base or the current project's. Any that wanted the current project's is a finding to report, not a thing to quietly preserve.
- `packages/config` is JS-Atomic — `.js` source with a hand-written `.d.ts`, no build step. Both must change together.
- Three states, never two. This line of work has produced nine instances of that shape, the ninth inside the instrument built to end it. Assume exposure.
- No cargo commands; never a bare `cargo test` in this repo regardless. Do not run any `diagrams:` script. Do not restart the node except where a task says to.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/config/src/index.js:150-153` + `index.d.ts` | The resolution itself. | 2 |
| `packages/config/src/*.test.js` | Pin it, including the precedence order. | 2 |
| the 24 call sites across 6 files | Audited, then updated for the signature change. | 1, 3 |
| `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` | Record the clause closed. | 5 |

---

### Task 1: Audit before touching anything

**Files:** none changed — this task produces a document.

Twenty-four call sites, in `apps/refarm/src/commands/`: `workspace.ts`, `context.ts`, `doctor.ts`, `scope-doctor.ts`, `workspace-sync.ts`, `ask.ts`, plus the definition in `packages/config`.

- [ ] **Step 1: For each call site, answer one question in writing** — did this caller want THE NODE'S declaration base, or THE CURRENT PROJECT'S directory?

Read what the resolved value is used for, not what the variable is named. A site that feeds `loadConfig` to read the node's catalog wanted the node's base. A site that resolves something about the directory the operator is inspecting wanted the project's.

- [ ] **Step 2: Name every site that wanted the current project's.** Those are the ones this change would break in a way that matters, and they need `resolveRefarmScopeRoot` or an explicit path rather than a silently-changed default. If there are none, say so — but say it after checking all 24, not before.

- [ ] **Step 3: Note `context.ts` specially.** It uses `declaredBase()` to compute `cliBase`, which it reports as the CLI's own resolved base and compares against the node's. After this change those two converge on the same machine, so the divergence it reports should disappear. That is the plan working, not a regression — but confirm the comparison still MEANS something: it must still fire when a shell genuinely declares a different `SOVEREIGN_BASE`.

Write the audit into your report before making any change. A change first and an audit after is how a "nothing broke" claim gets made without evidence.

---

### Task 2: The resolution changes

**Files:**
- Modify: `packages/config/src/index.js` (`declaredBase`) and `packages/config/src/index.d.ts`
- Test: the config package's test file

- [ ] **Step 1: Write the failing tests** — the three-step precedence, each pinned separately, plus that a caller standing anywhere gets the same answer:

```javascript
// SOVEREIGN_BASE wins outright.
declaredBase({ SOVEREIGN_BASE: "/declared", REFARM_HOME: "/other/.refarm" }) === "/declared"
// REFARM_HOME's parent is next — a container declaring /srv/node/.refarm gets /srv/node.
declaredBase({ REFARM_HOME: "/srv/node/.refarm" }) === "/srv/node"
// Otherwise the OS home, which does not change when the operator walks.
declaredBase({}) === os.homedir()
// Whitespace is not a declaration.
declaredBase({ SOVEREIGN_BASE: "   ", REFARM_HOME: "/srv/node/.refarm" }) === "/srv/node"
```

Add one that would have caught the old behaviour: assert the result does NOT equal `process.cwd()` when the environment declares nothing and the process is standing somewhere that is not the home directory. That test is the regression guard for the defect being removed.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @refarm.dev/config run test`

- [ ] **Step 3: Implement, and delete the `cwd` parameter.** Update `index.d.ts` in the same commit — the package is JS-Atomic and the declaration is hand-written source, so a stale `.d.ts` is a lie consumers compile against.

Keep the function's doc comment honest: it should now state that this mirrors `dirs_sovereign_base` in `packages/tractor/src/main.rs`, and that the two must change together.

- [ ] **Step 4: Verify.** `pnpm --filter @refarm.dev/config run test`, then `pnpm --filter @refarm.dev/config run type-check`.

- [ ] **Step 5: Commit.**

---

### Task 3: The call sites compile and mean what they meant

**Files:** the six files from Task 1's audit.

- [ ] **Step 1:** `pnpm --filter @refarm.dev/refarm run type-check` — the removed parameter will name every site that passed one.
- [ ] **Step 2:** Fix each according to Task 1's audit, not by reflex. A site that wanted the project's directory gets an explicit resolver; a site that wanted the node's base simply drops the argument.
- [ ] **Step 3:** `pnpm --filter @refarm.dev/refarm run test` — the full package suite. Report every test that changed behaviour and why; a test that needed editing is a behaviour claim that moved, and each one deserves a sentence.
- [ ] **Step 4: Commit.**

---

### Task 4: Prove it on the node

**Files:** none — evidence.

- [ ] **Step 1: Build.** `pnpm --filter @refarm.dev/refarm run build`

- [ ] **Step 2: The catalog resolves from anywhere, with NO `SOVEREIGN_BASE` exported.**

```bash
for d in "$PWD" ~/git/rcdc5 /tmp; do
  echo "--- from $d"
  (cd "$d" && refarm workspace list --json | python3 -c "
import sys,json; d=json.load(sys.stdin); print(' ', sorted(w['id'] for w in d['workspaces']))")
done
```

Expected: `['rcdc5', 'refarm']` from all three, with no variable set. Before this line of work it was the repository's own wrong catalog from the repository and empty elsewhere; after the workspace-is-not-a-node plan it was empty everywhere. Paste all three.

- [ ] **Step 3: The divergence the cockpit reports should be gone.**

```bash
refarm context
refarm doctor --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([r.get('diagnostic') for r in (d.get('recommendations') or [])])"
```

Expected: no `sovereign:base-divergence`, because the CLI now resolves the base the way the node does. If it still fires, report the raw output — that would mean the two halves still disagree and this plan did not close it.

- [ ] **Step 4: The comparison still means something.** Run `SOVEREIGN_BASE=/tmp/deliberately-wrong refarm context` and confirm `base-divergence` DOES fire. A comparison that can no longer fail would be worse than the disagreement it replaced.

- [ ] **Step 5: Gate and commit the evidence.** `refarm agent finish --lane after-edit --run --json`

---

### Task 5: Record it

**Files:** `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md`, and `.project/handoff.json` if the loose-ends queue is affected.

- [ ] Record that the TypeScript stack and the Rust host now resolve the base identically, that the guarantee in `packages/config`'s own comment is true for the first time, and the measurement that showed it was not.
- [ ] Record that `declaredBase` no longer takes a `cwd`, and why removing it beat defaulting it.
- [ ] Strike the decided-and-pending entry from the loose-ends queue, since it is now built.
- [ ] Record anything Task 1's audit found that wanted the project's directory and now uses an explicit resolver — that is the part a future reader will need.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| Every call site audited before the change | 1 |
| Precedence: `SOVEREIGN_BASE` → `dirname(REFARM_HOME)` → OS home | 2 |
| A regression guard asserting the result is not cwd | 2 |
| `cwd` removed rather than defaulted | 2 |
| `.d.ts` updated with the `.js`, same commit | 2 |
| Call sites fixed per the audit, not by reflex | 3 |
| Catalog resolves from anywhere with no variable set | 4 |
| `base-divergence` gone, and still able to fire | 4 |
| The clause recorded, the queue entry struck | 5 |

**Out of scope:** the Rust host is not changed — it is already correct and this plan makes TypeScript match it. `resolveRefarmScopeRoot`'s workspace-sidecar behaviour is untouched.
