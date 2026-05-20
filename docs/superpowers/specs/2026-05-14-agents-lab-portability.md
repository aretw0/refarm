# Agents-Lab Portability Spec

> **Lens**: Before adopting anything from agents-lab, ask: what problem does
> this solve, and does refarm face that problem? If yes: is the right solution
> the same one agents-lab chose, or does refarm's architecture (WASM-first,
> WIT contracts, radical extensibility) suggest a different answer?
>
> This spec classifies agents-lab components by that test — not by whether they
> are technically portable.

---

## What is agents-lab?

`aretw0/agents-lab` is a curated layer of extensions and skills for Pi (pi.dev).
It is published as `pi-stack` packages and also works with any Claude Code-compatible
environment (skills are pure Markdown). The lab curates for both Pi and refarm
ecosystems without requiring porting — the Markdown-based skill format is the
shared protocol.

Key components:
- **Skills** — Markdown files that activate on user request; same format in Pi and refarm
- **Extensions** — Pi-specific TypeScript packages using Pi's extension API
- **`.project/` shared memory schema** — JSON files for decisions, handoff, tasks, requirements, verification

---

## Category 1: Pure Markdown skills (immediately portable)

These work identically in Pi and refarm. No porting, no evaluation needed —
just install.

**git-skills**: Structured git workflows (commit conventions, branch naming,
PR prep). Does refarm need this? Yes — the monorepo has specific commit conventions
and PR patterns. The only question is whether the skill's instructions match
refarm's actual conventions (check against `CLAUDE.md` and recent commits).

**lab-skills essentials**:
- `cultivate-primitive` — guides creating new WIT interfaces or packages with
  the right structure. Directly useful in refarm's WASM-first world.
- `evaluate-extension` — helps decide whether something belongs in core or as
  a plugin. Aligns perfectly with refarm's core/plugin boundary question.
- `provider-model-discovery` — discovers available LLM providers and their
  model IDs. Refarm uses `MODEL_PROVIDER` env vars; this skill helps users
  configure correctly.

**Action**: Install `git-skills` and `lab-skills` essentials directly. Verify
against refarm's actual conventions before treating as authoritative.

---

## Category 2: Concepts worth understanding (don't copy, understand the why)

### context-watchdog

**What it does**: Monitors conversation context usage. Triggers compaction at
50% (soft warn), 68% (medium), 72% (hard compaction with checkpoint). The
thresholds were derived empirically from Pi's usage patterns.

**Problem it solves**: LLM context windows overflow during long sessions, causing
the model to lose earlier context, make inconsistent decisions, or hallucinate
what was previously agreed. Compaction summarizes and restarts without losing
continuity.

**Does refarm face this problem?** Yes — `refarm chat` with `MODEL_HISTORY_TURNS`
enabled will face the same context pressure. The `SessionDigestContextProvider`
in `context-provider-v1` is a start but is not dynamic.

**Is the solution the same?** The 50/68/72% thresholds are Pi-specific — they
were tuned for Pi's conversation structure. Refarm should implement compaction
with tunable thresholds, not hardcode Pi's numbers. The mechanism (checkpoint
at threshold, summarize, resume) is sound and worth adopting.

**Refarm answer**: Add a `compactionThreshold` config to `MODEL_HISTORY_TURNS`
context; implement compaction as a pi-agent behavior (inside the WASM ReAct loop,
not as an external watchdog). This keeps the policy in the guest, not the host.

**When**: After self-iteration is working and context overflow becomes observable.
Not before.

---

### guardrails-core

**What it does**: Enforces tool hygiene — path restrictions, bash command
allowlists, argument validation. Implemented as Pi extension API hooks
(`beforeToolCall`, `afterToolCall`).

**Problem it solves**: Agentic systems that can spawn subprocesses and write
files need a safety boundary. Without it, a prompt-injected or hallucinating
agent can delete files, exfiltrate secrets, or run arbitrary commands.

**Does refarm face this problem?** Yes, and more acutely — pi-agent running
inside Tractor has access to `agent-shell.spawn` with a 30-second timeout cap.
The cap prevents hanging but not malicious commands.

**Is the solution the same?** No. agents-lab implements guardrails as Pi
extension API hooks (TypeScript, Pi-specific). Refarm's equivalent is **Scarecrow**
— a WIT observation interface that fires before and after tool calls, enforced
at the WASM host boundary. Scarecrow cannot be bypassed by the guest; Pi extension
hooks can be skipped if the extension isn't loaded.

**Refarm answer**: `docs/superpowers/specs/2026-05-13-barn-scarecrow-evolution.md`
Steps 3+4 (Scarecrow WIT hooks + policy plugin) are the correct refarm answer
to this problem. The problem guardrails-core solves is real; the implementation
is Pi-specific and does not port.

**When**: After Barn Steps 1+2 (filesystem cache adapter — already done). Steps
3+4 are the next iteration.

---

### quota-visibility

**What it does**: Surfaces LLM spend per provider with rolling 30-day window.
Shows current spend vs. `MODEL_BUDGET_<PROVIDER>_USD` cap.

**Problem it solves**: Users don't know how much they're spending until their
key stops working.

**Does refarm face this problem?** Yes — pi-agent already reads `MODEL_BUDGET_*`
env vars and blocks requests that exceed the cap. The blocking logic exists;
the visibility (showing spend in the REPL) does not.

**Refarm answer**: Add `/budget` command to `refarm chat` that reads spend from
the `UsageRecord` CRDT nodes that pi-agent already writes. This is a REPL command,
not an extension — the data is already there.

**When**: After daily driver baseline works. This is a quality-of-life feature.

---

### colony-pilot

**What it does**: Multi-agent orchestration — spawn, coordinate, and collect
results from parallel Pi agents.

**Problem it solves**: Some tasks parallelize naturally (review N files, test N
scenarios). Orchestrating this manually is tedious.

**Does refarm face this problem?** Eventually. The farmhand task model supports
multiple tasks per effort (`Effort.tasks: Task[]`), and the stream transport
handles multiple concurrent efforts. The plumbing exists; the orchestration UX
doesn't.

**Is the solution the same?** Pi's colony uses Pi extension API. Refarm's answer
would be: multiple tasks in one effort, or a "colony effort" type that fans out.
The design needs thought; don't port colony-pilot directly.

**When**: After single-agent self-iteration works reliably. Multi-agent is a
multiplier on whatever quality level single-agent achieves.

---

## Category 3: Shared protocol (already working, nothing to do)

### `.project/` shared memory schema

Both agents-lab and refarm use the same JSON files for shared context:
- `decisions.json` — architectural decisions made during a session
- `handoff.json` — state passed between sessions
- `tasks.json` — in-progress work items
- `requirements.json` — current requirements context
- `verification.json` — test/check outcomes

**This works today.** Skills that read/write `.project/` work identically in
Pi and refarm. No action needed.

---

## Summary table

| Component | Problem real in refarm? | Port directly? | Refarm answer | When |
|---|---|---|---|---|
| git-skills (Markdown) | Yes | Yes — verify conventions | Install as-is | Now |
| lab-skills essentials | Yes | Yes | Install as-is | Now |
| context-watchdog thresholds | Yes | No — Pi-specific numbers | Tunable compaction in pi-agent | After self-iteration works |
| guardrails-core hooks | Yes | No — Pi extension API | Scarecrow WIT Steps 3+4 | Next barn step |
| quota-visibility | Yes | No — read from CRDT instead | `/budget` REPL command | After daily driver |
| colony-pilot | Eventually | No — different architecture | Multi-task effort model | After single-agent works |
| `.project/` schema | Yes | Already works | Nothing | Nothing |

---

## Principle

The safe import rule: a skill or concept from agents-lab is worth bringing into
refarm when (1) the problem is real in refarm, (2) the solution is architecture-
compatible, and (3) it doesn't introduce a Pi-specific dependency that creates
coupling. Skills pass all three by design. Extensions fail #3 by design.
