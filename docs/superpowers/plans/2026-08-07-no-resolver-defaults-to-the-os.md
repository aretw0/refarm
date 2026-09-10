# No Resolver Defaults to the OS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible to add a new resolver that silently falls back to where the process happens to be standing, then burn down the ones that already do.

**Architecture:** A ratchet, not a rewrite. One test declares that exactly two modules may ask the OS where they are; everything else must take its base explicitly or read a declaration. The test records today's count and fails when it RISES. Migration then happens in auditable slices, and the number only goes down.

**Tech Stack:** `node:test` (`scripts/*.test.mjs`, co-located — there is no `scripts/test/` directory in this repo).

## The measurement this plan is built on

Taken 2026-08-07 across `apps/*/src` and `packages/*/src`, excluding tests and `dist/`:

| | Count | Files |
| --- | --- | --- |
| `process.cwd()` | 155 | 86 |
| `os.homedir()` / `homedir()` | 29 | 19 |
| Rust `current_dir()` | 12 | — |
| Rust `home_dir()` | 1 | — |

Broken down by shape — and the breakdown is the whole point:

| Shape | Count | Verdict |
| --- | --- | --- |
| `= process.cwd()` as a parameter default | 43 | **defect** |
| `?? process.cwd()` / `?? homedir()` inline fallback | 60 | **defect** |
| `= process.env` as a parameter default | 92 | **correct — leave alone** |

**The 92 are not a target.** Reading the declaration is the behaviour we want; a resolver that takes `env = process.env` and reads `REFARM_HOME` from it is right. Attacking "the 155" without this distinction would have rewritten 92 correct call sites.

The center already exists and is already adopted: **31 files import `apps/refarm/src/utils/refarm-home.ts`** and **22 use `declaredBase`/`sovereignDir` from `packages/config/src/index.js`**. This plan does not build a center. It makes the existing one non-optional.

## Why the default parameter is the footgun

Every dangerous site has one shape:

```ts
function resolveTlsDir(root: string = process.cwd()): string
function resolveHealthPolicy(rootDir = process.cwd()): HealthPolicy
function resolveProcessTrailPath(root: string = process.cwd()): string
```

Forgetting the argument does not raise an error. It produces the current directory — which is almost always right while developing in the repo and almost always wrong in production. The failure is invisible exactly where it is tested and visible only where it costs something.

Two live instances from 2026-08-05/07, both found by running rather than reading:

- `refarm connection status --json` listed the operator's VPN from `~/github/refarm` and returned **nothing** from `~/git/rcdc5` or `/tmp`. His own connection, invisible from inside his own workspace.
- The sandbox's plugin install wrote the working tree's `agent.wasm` into the operator's real `~/.refarm/assets/` (confirmed on disk, mtime 2026-08-07 07:56), because `packages/storage-fs/src/scope.ts:60-63` does `options.userHome ?? homedir()` and never consults the declared home.

## Global Constraints

- **The 92 `= process.env` sites are OUT OF SCOPE and must not be touched.** A slice that changes one has misread this plan.
- **The ratchet must never be loosened to make a slice pass.** Raising the baseline to accommodate new code defeats the entire mechanism. The number goes down or the slice is wrong.
- **A migrated site must be audited, not converted by reflex.** For each, answer in writing: did this caller want THE NODE'S base, or THE CURRENT PROJECT'S directory? Some commands legitimately operate where the operator is standing — `release`, `cert`, `scan`. Those get an EXPLICIT resolver call, not a silent default; the fix is removing the default, not removing the concept.
- `apps/refarm` is TypeScript with `.js` import specifiers. `packages/config` is JS-Atomic (`.js` source plus a hand-written `.d.ts` — both change together, no build).
- Never run a bare `cargo test` (OOM risk, CLAUDE.md §7). Do not rebuild the WASM agent. Do not run any `diagrams:` script.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/no-os-resolution.test.mjs` | **New.** The ratchet: scan, allowlist, baseline. | 1 |
| `docs/NO_OS_RESOLUTION.md` | **New.** The rule, why, and how to burn down. | 1 |
| the 43 signature-default sites | Audited, then made explicit. | 2+ |
| the 60 inline-fallback sites | Audited, then made explicit. | later |
| `packages/storage-fs/src/scope.ts` | The known Critical: `options.userHome ?? homedir()`. | later |

---

### Task 1: The ratchet

**Files:** `scripts/no-os-resolution.test.mjs`, `docs/NO_OS_RESOLUTION.md`

**Interfaces:**
- Produces `scanForOsResolution(files)` — PURE. Takes file contents, returns the offending sites. Unit-test it with literals; the filesystem walk is a thin impure edge.

The allowlist is exactly two modules, and it is a WHITELIST — anything not named is forbidden, so a new resolver module cannot join by accident:

```
apps/refarm/src/utils/refarm-home.ts
packages/config/src/index.js
```

- [ ] **Step 1: Write the failing test for `scanForOsResolution`** with literal file contents: a `= process.cwd()` default is found; a `?? homedir()` fallback is found; a `= process.env` default is NOT found; a commented-out occurrence is NOT found; an occurrence inside a string literal is NOT found. That last pair matters — a scanner that counts comments and strings produces a baseline nobody can burn down, because the number stops corresponding to real sites.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement**, and record the baseline the scan actually produces. **Do not hardcode 103 from this document** — this plan's numbers came from `grep`, and a real parser will disagree at the edges. The scan's own number is the baseline; report both and explain any gap.
- [ ] **Step 4: The ratchet asserts the count does not RISE**, and prints the current number and the delta on every run so the burn-down is visible without reading code.
- [ ] **Step 5: Prove the ratchet catches a new offender.** Add `const x = process.cwd();` to a non-allowlisted file in a scratch copy, confirm the test goes red, remove it. A guard nobody has seen fail is a guard nobody knows works.
- [ ] **Step 6: Write `docs/NO_OS_RESOLUTION.md`** — the rule, the two allowlisted modules, why `= process.env` is correct and excluded, the two live failures above, and how to run a burn-down slice.
- [ ] **Step 7: Wire it into the repo's test run** so it executes in CI rather than only when someone remembers.
- [ ] **Step 8: Commit.**

---

### Task 2: The first burn-down slice — the signature defaults

**Files:** chosen from the scan's own output; the 43 `= process.cwd()` sites.

Take a coherent slice (one command family, not a scattering) so the audit is reviewable.

- [ ] **Step 1: Audit before changing.** For each site in the slice, state in writing whether it wanted the node's base or the current project's directory. Read what the value is USED for, not what the parameter is named.
- [ ] **Step 2: Make it explicit.** A site that wanted the node's base calls `resolveRefarmScopeRoot`/`declaredBase`. A site that genuinely wanted the operator's current directory keeps that meaning but takes it as a REQUIRED argument, so a caller must say so.
- [ ] **Step 3: Run the package's tests**, and report every test that changed behaviour and why — a test that needed editing is a behaviour claim that moved.
- [ ] **Step 4: Lower the baseline by exactly the number of sites removed**, and state the before and after in the commit message.
- [ ] **Step 5: Commit.**

---

## Self-Review

| Requirement | Task |
| --- | --- |
| A new OS-defaulting resolver is impossible to add unnoticed | 1 |
| The allowlist is a whitelist, not a blacklist | 1 |
| `= process.env` is excluded by construction, not by care | 1 |
| Comments and string literals do not inflate the baseline | 1 |
| The ratchet has been SEEN to fail | 1 |
| The rule is written down where a newcomer finds it | 1 |
| Sites are audited for intent, not converted by reflex | 2 |
| The baseline only ever falls | 2 |

**Out of scope:** the Rust `current_dir()` sites (12) and `config_node.rs:48-55` — a separate slice with a separate ratchet; `packages/storage-fs/src/scope.ts` — known, queued, and wider than this plan; the 92 `= process.env` sites — correct as they are.
