# The Sandbox Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator run a second, isolated refarm node out of this working tree — its own sovereign dir, port, namespace and graph — without re-authenticating and without an experiment's cost landing in his real ledger.

**Architecture:** A node's state lives on **four** axes, and isolating three of them is not isolation. `REFARM_HOME` relocates the declarations, plugins, streams and task-results; `XDG_DATA_HOME` relocates the graph, which does NOT follow the sovereign dir; and the WebSocket and HTTP surfaces are two separate ports, not one. Credentials are inherited from the operator's home rather than isolated, because isolation that forces re-authentication does not get used.

**Tech Stack:** Bash (`scripts/`), TypeScript (`apps/refarm`, vitest). No Rust changes, no WASM rebuild.

**Spec:** `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md`, D3 and D4.

## Why this is now buildable

The spec named the launcher on 2026-08-05 and it was blocked on a collision: `<repo>/.refarm/` was the node's own catalog, so a node rooted in this tree fought with the operator's. Three plans since removed that. `<repo>/.refarm/` no longer declares any workspace, the node declares its own base rather than inheriting the repository's, and `refarm context` can now prove which sovereign state a process is actually using — which is what makes "the sandbox is isolated" a measurement rather than a claim.

The operator's stated reason for wanting this, in his own framing: to keep developing refarm without the development being confused with the node he depends on. The concrete instance is cost. On 2026-08-05 the live proofs for the workspace-attribution work wrote test dispatches into his real `BudgetObservation` record because there was nowhere else for them to go, and 8 of the 29 observations in that record are ours.

## The four axes, measured 2026-08-06

The plan originally said "one pair of declarations relocates everything." That was false, and false precisely on the axis this plan exists to prove. Measured before writing a line:

| Axis | Holds | Relocated by | Follows `REFARM_HOME`? |
| --- | --- | --- | --- |
| Sovereign dir | config, plugins, connections, trusted_plugins, streams, task-results | `REFARM_HOME` (`main.rs:431`, `dirs_sovereign_base` at `:760-776`) | — it IS this |
| **Graph** | **the nodes — including `BudgetObservation`** | **`XDG_DATA_HOME`** (`storage/sqlite.rs:433-438`), plus `--namespace` for the db name | **NO** |
| WebSocket surface | port 42000 (`main.rs:52`) | `--port` | no |
| HTTP sidecar | port 42001 (`main.rs:120`) | `--http-port` | no |

The operator's live node couples the graph to the sovereign dir **by declaration, not by code**: its environ shows `XDG_DATA_HOME=/home/s095407044/.refarm/data`, set by `scripts/tractor-start.sh`, so its real graph is `~/.refarm/data/refarm/default.db` (270 KB, live). The `~/.local/share/refarm/default.db` the code falls back to is a 49 KB leftover nothing reads.

That makes the axis more dangerous, not less. A sandbox declaring only the sovereign pair would not have corrupted the operator's ledger — it would have silently opened the stale fallback db, looked like it worked, and produced a cost proof measuring nothing. A wrong answer that announces itself is cheaper than a plausible one that does not.

`SOVEREIGN_BASE` needs no separate reasoning on the Rust side: `main.rs:773` derives it from `refarm_dir.parent()` when unset. It is declared anyway so the TypeScript half resolves the same base — `declaredBase()` reads `SOVEREIGN_BASE` first, then `dirname(REFARM_HOME)`, so either alone would work and both agreeing is cheap.

## What agents-lab already proved, and what to take from it

`~/github/agents-lab/scripts/pi-isolated.mjs` solves the same problem for `pi`. Three properties are worth taking:

1. **One variable relocates everything.** No partial isolation to reason about.
2. **Credentials are inherited, not isolated** — `auth.json` is copied from the global dir. Isolation that forces re-authentication does not get used.
3. **Isolation ships with parity.** `pi-parity.mjs` compares what is configured against declared profiles. Isolation without a parity check trades one silent drift for another.

## Global Constraints

- **The operator's node is never touched.** Not its sovereign dir, not its port, not its process. Every task that runs anything states which node it is talking to, and a task that cannot tell STOPS rather than guessing.
- **BOTH ports must be relocated.** The operator's node binds 42000 (WebSocket) and 42001 (HTTP sidecar) — verified listening on both loopback and its Tailscale address. Relocating one and colliding on the other is the confusion this exists to end, wearing the costume of isolation.
- **The graph is the axis that matters.** If a task cannot show the sandbox reading and writing a DIFFERENT database file from the operator's, it has not isolated anything, whatever the other three axes say.
- **Inherited credentials are COPIED, never symlinked or shared by reference.** A sandbox that can write the operator's credential store is not isolated.
- **`.sandbox/` must be gitignored.** Verify rather than assume; if it is not, add it and say so.
- Three states, never two. This line of work has produced ten instances of that shape, several inside the instruments built to end it.
- `apps/refarm` is TypeScript with `.js` import specifiers. No cargo; never a bare `cargo test` in this repo regardless. Do not run any `diagrams:` script.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/refarm-sandbox.mjs` | **New.** The launcher: declare, inherit, start, status, reset. | 1, 2, 3 |
| `scripts/test/refarm-sandbox.test.mjs` | **New.** Its pure parts. | 1, 3 |
| `package.json` | `refarm:sandbox` scripts. | 1 |
| `.gitignore` | `.sandbox/` if absent. | 1 |
| `apps/refarm/src/commands/parity.ts` + test | **New.** `refarm parity`. | 5 |
| `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` | D3/D4 recorded as delivered. | 6 |

---

### Task 1: The declarations, and a node that starts

**Files:** `scripts/refarm-sandbox.mjs`, its test, `package.json`, `.gitignore`

**Interfaces:**
- Produces `sandboxEnvironment(repoRoot)` — PURE, returns the env pairs the sandbox node needs. Test it with literals.

All four axes, per the table above:

```
SOVEREIGN_BASE = <repo>/.sandbox
SOVEREIGN_DIR  = refarm
REFARM_HOME    = <repo>/.sandbox/refarm     # declarations, plugins, streams, task-results
XDG_DATA_HOME  = <repo>/.sandbox/share      # THE GRAPH — does not follow the above
--port / --http-port                        # BOTH surfaces
--namespace                                 # names the db file inside XDG_DATA_HOME
```

`REFARM_HOME` names the same directory `SOVEREIGN_BASE + SOVEREIGN_DIR` resolves to, deliberately: `declaredBase()` now derives the base from `dirname(REFARM_HOME)`, so declaring both keeps the TypeScript stack and the Rust host agreeing about the sandbox exactly as they now agree about the operator's node.

Choose both ports from what is actually free rather than picking numbers and hoping — and DECLARE them, so `refarm context` can report them.

- [ ] **Step 1: Write the failing test** for `sandboxEnvironment` — that it returns all four declarations plus both ports; that the sovereign trio is mutually consistent (`dirname(REFARM_HOME) === SOVEREIGN_BASE` and `basename(REFARM_HOME) === SOVEREIGN_DIR`); that `XDG_DATA_HOME` is inside the sandbox and is NOT inside `REFARM_HOME` (it is a sibling — asserting it separately is what stops a later edit from quietly folding the graph back under the sovereign dir); and that neither port is 42000 or 42001.

Add the test that would have caught the defect this task was written with: assert that the returned environment contains a declaration for the graph AT ALL. The first draft of this plan had three axes and called it "everything".
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement**, and confirm `.gitignore` covers `.sandbox/`.
- [ ] **Step 4: Start the sandbox node** and confirm it is a DIFFERENT process from the operator's, on different ports, with its own sovereign dir AND its own database file. Show the db path the sandbox actually opened, not the one it was told to; `ls` the sandbox's `share/refarm/` and show the operator's `~/.local/share/refarm/` is unchanged. Both nodes running at once is the point; if starting the sandbox disturbs the operator's node in any way, STOP and report.
- [ ] **Step 5: Commit.**

---

### Task 2: Credentials are inherited, not re-entered

**Files:** `scripts/refarm-sandbox.mjs`

Isolation that forces re-authentication does not get used — that is why `pi-isolated` copies `auth.json`.

**Determine the minimum set rather than guessing.** The operator's node authenticates through Silo (`~/.silo`), and `refarm resume --json` reports `credential.state: "silo-oauth"` with `envKey: OPENAI_CODEX_ACCESS_TOKEN`. Find what the sandbox actually needs to reach a model provider without a fresh login, COPY it, and report exactly what you copied and why each piece was necessary.

**The agent plugin is part of this.** The operator's node runs with `--plugin ~/.refarm/plugins/refarm_agent/plugin.wasm` — a sandbox with no plugin is a daemon that can hold a graph and answer nothing. Decide deliberately whether the sandbox loads the operator's installed plugin or the working tree's freshly-built one, and say which and why; "the one being developed" is a defensible answer for a lab and so is "the same one the operator runs", but they are different labs and the choice must be recorded rather than fall out of a default.

- [ ] **Step 1:** Determine and document the minimum set. If some of it cannot be copied — a token bound to a device identity, say — report that plainly rather than copying more in the hope it works.
- [ ] **Step 2:** Copy it, never symlink. A sandbox that can write the operator's credential store is not isolated; verify the copies are independent by checking that writing in the sandbox leaves the operator's file unchanged.
- [ ] **Step 3:** Prove it — a sandbox node that resolves a model route without prompting for credentials. `refarm model current --json` against the sandbox is the cheapest check; do NOT spend the operator's quota on an `ask` for this.
- [ ] **Step 4: Commit.**

---

### Task 3: `status` and `--reset`

**Files:** `scripts/refarm-sandbox.mjs`, its test

`status` answers which sandbox exists and whether its node is running. `--reset` deletes the sandbox and NOTHING else — it must be impossible for it to touch `~/.refarm`, and a test must pin that.

- [ ] Write the failing tests first, including one asserting that a reset path outside `<repo>/.sandbox` is refused rather than executed.
- [ ] Implement, verify, commit.

---

### Task 4: Prove the isolation, and prove the cost lands in the sandbox

**Files:** none — evidence. This is the task the plan exists for.

- [ ] **Step 1:** With both nodes running, run `refarm context` against each and paste both. The sandbox must report its own sovereign home, its own port, its own namespace — and the operator's node must be unchanged from before.

- [ ] **Step 2: The cost proof.** Dispatch ONE `refarm ask` against the SANDBOX node, then show that the observation landed in the sandbox's `BudgetObservation` record and that the operator's record did NOT grow. Record both counts before and after.

  This is the operator's stated reason for wanting the sandbox, so it is the measurement that decides whether this plan delivered. One ask, not several — it spends his real subscription quota either way, and one is enough to prove where the record goes.

- [ ] **Step 3:** Confirm the operator's node is untouched: same pid, same plugin hash, same observation count as before Step 2.

- [ ] **Step 4: Gate and commit the evidence.**

---

### Task 5: `refarm parity`

**Files:** `apps/refarm/src/commands/parity.ts` and its test

Isolation without parity trades one silent drift for another. `refarm parity` compares the sandbox against the operator's node on DECLARED axes — configured providers and routes, installed plugins with their hashes, engine, namespace — and reports where they differ.

Divergence in a lab is normal. **Undeclared divergence is what makes a lab lie**, so the output distinguishes "differs, and that is the point" from "differs, and nobody said it would".

- [ ] Write failing tests for the pure comparison first, driven by literals.
- [ ] Implement, wire the command, verify, run it live against both nodes and paste the output, commit.

---

### Task 6: Record D3 and D4 as delivered

**Files:** the spec, and `.project/handoff.json`

- [ ] Record what shipped, the port and namespace chosen, and exactly what credentials are inherited — the last is the part a future reader most needs and most easily gets wrong.
- [ ] Record the cost proof's numbers from Task 4.
- [ ] Record what is NOT isolated. Anything shared between the two nodes is a fact someone will trip over; name it rather than letting it be discovered.
- [ ] Strike the sandbox entries from the loose-ends queue.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| All four axes relocated — sovereign dir, GRAPH, WS port, HTTP port | 1 |
| The graph proven to be a different db file, not just a different config | 1, 4 |
| The two halves agree about the sandbox, as they now do about the node | 1 |
| Both ports chosen from what is free and declared | 1 |
| Credentials inherited by COPY, minimum set determined not guessed | 2 |
| `--reset` cannot touch anything outside the sandbox | 3 |
| Both nodes run at once; the operator's is untouched | 1, 4 |
| An ask against the sandbox lands in the SANDBOX's record | 4 |
| Parity reports declared versus undeclared divergence | 5 |
| What is NOT isolated is named | 6 |

**Out of scope:** the workspace hatch (ADR-094's `homeMode`/`credentialMode`/`runtimeNamespaceMode`); the 33 positional `process.cwd()` call sites recorded separately in the loose-ends queue; any change to the operator's node.
