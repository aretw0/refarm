# The Answer Must Not Depend On Where You Stand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and close the commands whose answer changes with the operator's current directory when it should not — measured by consequence, not by code shape.

**Architecture:** A behavioural probe, not a scan. Run each read-only `--json` command from several directories and compare the answers. A command that must be directory-independent DECLARES that; one that legitimately varies declares which fields vary and why. Undeclared divergence fails.

**Tech Stack:** `node:test` (`scripts/*.test.mjs`, co-located), TypeScript (`apps/refarm`).

## This plan replaces a mis-aimed one, and the correction is the point

The first version of this plan selected work by SHAPE: it took the ten sites from `scripts/no-os-resolution.mjs`'s scan whose filenames sounded like attribution and called them the attribution path. Task 1 was written as a stop gate — *"if the trace shows something ELSE decides these fields, STOP and report"* — and it fired. Measured 2026-08-07, verified independently:

- **`refarm.workspace.id` is decided by none of the ten.** `resolveDispatchWorkspace` at `apps/refarm/src/commands/ask.ts:820` decides it, and its `process.cwd()` there is deliberate and documented: *"The interactive entry, and only here, knows a human chose this directory."* It is the four-degree ladder, working as designed.
- **`host.name` is not TypeScript at all.** `packages/tractor/src/node_identity.rs:174` (`declared_node_name`) decides it.
- **The live VPN failure comes from `apps/refarm/src/commands/connection.ts:830`**, which is not one of the ten.
- **Eight of the ten legitimately want the operator's current directory.** Converting them would have been churn on correct code.

The ratchet counts by shape, which is right for its job — stopping new ones. It is not a map of what hurts. Those are two projects and the first version conflated them.

## The probe, and what it found

Five read-only `--json` commands, each run from `~/github/refarm`, `~/git/rcdc5` and `/tmp`, answers compared:

| Command | Result |
| --- | --- |
| `workspace list` | identical from all three |
| `model current` | identical |
| `plugin status` | identical |
| **`connection status`** | **diverges — a real defect** |
| `context` | diverges — legitimately |

`connection status` from `/tmp` returns `connections: []` where the repo returns one, and `nextAction` falls from *"Connection 'ovpn-serpro' is down — bring it up"* to `null`. The operator's own VPN does not exist, and the CLI stops telling him what to do about it.

`context` loses `builtPluginPath` and `builtPluginSha` outside the repo. That is correct: they are facts about the working tree, and a working tree is not visible from `/tmp`. Divergence that IS the purpose.

**The distinction between those two rows is the whole design.** It is the same distinction `refarm parity` already draws between an isolating axis and a mirroring one, and the same one its `blindTo` field makes machine-readable. This plan brings it to the CLI's own surface.

## Global Constraints

- **Declared divergence is data, not an exception list.** A command that legitimately varies says WHICH fields vary; the probe compares everything else. A blanket "this command is exempt" would hide a real defect inside a legitimate one.
- **The probe must run commands, not read code.** Its value is that it finds defects the shape-scan cannot see and skips correct code the shape-scan flags. If it degrades into a static analysis, it has become the ratchet and is redundant.
- **Read-only commands only.** Nothing in the probe may mutate state, spend model quota, or signal a process. `refarm ask` is forbidden.
- The operator's node (pid 3093335) is never restarted, stopped or signalled; `~/.refarm`, `~/.silo`, `~/.local/share/refarm` are read-only. Verify by snapshotting both trees recursively before and after — do not enumerate the paths you expect to be untouched; that method already missed a real write into `~/.refarm/assets/`.
- The ratchet (`scripts/no-os-resolution.mjs`, baseline 119) must not rise. If a fix lowers it, lower the baseline in the same commit and say so.
- Never run a bare `cargo test` (OOM risk, CLAUDE.md §7). Do not rebuild the WASM agent. Do not run any `diagrams:` script.
- Three states, never two. Fifteen instances of a set treated as complete when a member is missing, eight of an instrument reporting a result it had not earned. A probe result is `same | differs-as-declared | differs-undeclared` — and a command that FAILS to run from a directory is a fourth thing, not a divergence.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/directory-independence.mjs` + `.test.mjs` | **New.** The probe and its declarations. | 1 |
| `apps/refarm/src/commands/connection.ts:499,830` | The defect the probe found. | 2 |
| `docs/NO_OS_RESOLUTION.md` | Record that shape and consequence are two instruments. | 3 |
| `.project/handoff.json` | The queue. | 3 |

---

### Task 1: The probe

**Files:** `scripts/directory-independence.mjs`, `scripts/directory-independence.test.mjs`

**Interfaces:**
- Produces `compareAnswers(byDirectory, declaration)` — PURE. Takes the parsed answers keyed by directory plus the command's declaration, returns `same | differs-as-declared | differs-undeclared | unrunnable` with the offending field paths. Unit-test with literals.
- Produces the declaration table: for each probed command, whether it must be directory-independent and, if not, which field paths may vary.

Start with the five commands already measured, and their known results — `workspace list`, `model current`, `plugin status` (must be identical), `context` (`builtPluginPath`, `builtPluginSha` may vary), `connection status` (must be identical — it is the defect, and the probe should FAIL until Task 2).

- [ ] **Step 1: Write the failing tests for `compareAnswers`** with literal answer objects: identical answers → `same`; a difference only in a declared-varying field → `differs-as-declared`; a difference in any other field → `differs-undeclared` naming the path; a directory where the command did not run → `unrunnable`, never silently `same`. That last case matters — a command that crashes in `/tmp` produces no output, and comparing two empty results would read as agreement.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, including the impure edge that actually invokes the CLI from each directory with a timeout.
- [ ] **Step 4: Run it and report the table.** `connection status` is expected to fail; that is the probe working, not a bug in it. Do NOT fix the command here.
- [ ] **Step 5: Prove the probe catches a NEW divergence.** Temporarily make a directory-independent command depend on cwd in a scratch copy, watch the probe go red, revert. A guard nobody has seen fail is a guard nobody knows works.
- [ ] **Step 6:** Wire it so it can be run on demand (`package.json`). **Do not add it to any GitHub workflow** — it invokes the built CLI and takes seconds per command, and `.github/workflows/**` is a CLAUDE.md §8 protected surface whose last modification is still awaiting the operator's ruling. Say in your report where it WOULD belong.
- [ ] **Step 7: Commit.**

---

### Task 2: The connection command answers from anywhere

**Files:** `apps/refarm/src/commands/connection.ts` (`:499` and `:830`, both `const baseDir = deps?.cwd?.() ?? process.cwd();`)

- [ ] **Step 1: Audit both sites before changing either.** What is `baseDir` used for at each? Which declaration should decide it — and check whether the answer differs between the two, because two sites in one file with the same shape are not necessarily the same question.
- [ ] **Step 2: Fix per the audit.** The connections catalog belongs to the NODE, so it should resolve the way the node's other declarations do; but verify that against what the code actually reads rather than assuming it.
- [ ] **Step 3: Run the package suite** and report every test whose behaviour changed and why.
- [ ] **Step 4: The probe goes green.** Re-run Task 1's probe; `connection status` must now be identical from all three directories. Paste the table.
- [ ] **Step 5: The operator's own instance.** From all three directories, show `ovpn-serpro` present and `nextAction` non-null. This is his live pain and it is the acceptance test.
- [ ] **Step 6:** If the ratchet baseline fell, lower it in the same commit and state before and after.
- [ ] **Step 7: Commit.**

---

### Task 3: Record it

**Files:** `docs/NO_OS_RESOLUTION.md`, `.project/handoff.json`

- [ ] Record that there are now TWO instruments and what each is for: the ratchet counts by SHAPE and stops new defects; the probe measures by CONSEQUENCE and finds the ones that hurt. Record that the first version of this plan conflated them, and that eight of its ten targets were correct code.
- [ ] Record the probe's table as of this commit, so the next reader starts from a measurement rather than a scan.
- [ ] Record what the probe does NOT cover: the commands not yet in its table, and the fact that it only sees `--json` read-only surfaces.
- [ ] Update the queue.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| Work selected by consequence, not by shape | 1 |
| Declared divergence is per-field, not per-command | 1 |
| A command that fails to run is not reported as agreeing | 1 |
| The probe has been SEEN to fail | 1 |
| Both `connection.ts` sites audited separately | 2 |
| The operator's VPN visible from all three directories | 2 |
| Two instruments, and the difference written down | 3 |

**Out of scope:** the other 119 − N ratchet sites (held, not urgent); the Rust `current_dir()` sites; `packages/storage-fs/src/scope.ts`; and `refarm budget` gaining grouping by workspace, node, surface and period — that is the cost plan, and the audit showed it is NOT blocked by this one, since `refarm.workspace.id` is already decided by a deliberate, working ladder.
