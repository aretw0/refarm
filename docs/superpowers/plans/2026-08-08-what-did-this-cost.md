# What Did This Cost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator ask what a workspace, a node, or a period cost — in the currency his work is actually billed in.

**Architecture:** Read-only queries over the `BudgetObservation` record that already exists. No new counter, no new field, no change to what is written. `refarm budget` gains grouping and period filtering; the reported quantity is requests and tokens, because dollars are honestly zero for every observation on this machine.

**Tech Stack:** TypeScript (`apps/refarm/src/commands/budget.ts`, vitest).

## The measurement this plan is built on

Taken 2026-08-08 against the operator's live graph, 29 `BudgetObservation` nodes spanning 03/08 21:21 → 05/08 17:29:

| Field | Coverage | Value |
| --- | --- | --- |
| `refarm.pricing_mode` | 29/29 | **`subscription`, all of them** |
| `refarm.cost.estimated_usd` | 29/29 | **sums to 0.0** |
| `refarm.cost.price_known` | 26/29 | — |
| `gen_ai.usage.output_tokens` | 29/29 | 590 total |
| `refarm.workspace.id` | **8/29** | `refarm` ×5, `rcdc5` ×3, **21 unattributed** |
| `host.name` / `host.id` | 21/29 · 22/29 | — |
| `refarm.budget.spawner` | 29/29 | `refarm-ask` ×22, `capability-dispatch` ×7 |
| `timestamp_ns` | 29/29 | — |

**The dollar axis is not incomplete — it is honestly zero, in 100% of the record.** Every dollar column, ceiling and query would return `0.00` forever on this operator's real usage. The countable unit is requests and tokens per billing period. This is loose-end #21, and its own note from 2026-08-05 was right: the axis needs no new counter, because `timestamp_ns` and `refarm.pricing_mode` are already on every record.

**Twenty-one of twenty-nine observations have no workspace.** Attribution shipped on 2026-08-05 and only later records carry it. A per-workspace report that quietly drops those would understate every workspace and look complete doing it.

## What is NOT in this plan, and the number that says why

590 output tokens over two days is the whole refarm ledger. The session that built this plan spent roughly 6.5M subagent tokens, and none of it is in the record, because refarm did not dispatch it. That is loose-end open-question #2, and the operator chose to build the queries first: **the queries work identically over 29 records or 29 million, and they become the instrument that shows whether ingestion is working when it lands.** Do not build ingestion here.

## Global Constraints

- **Requests and tokens are the primary quantity. Dollars are secondary and must be shown as `—` rather than `$0.00` when `pricing_mode` is `subscription`.** A report that prints `$0.00` next to real work teaches the operator to ignore the column; a report that prints `—` teaches him the axis does not apply.
- **Unattributed records are a LINE, never a dilution.** A group-by-workspace report must show `(unattributed) 21` as its own row. Folding them into a total, or dropping them, produces a number that is wrong in the direction nobody checks.
- **Read-only. This plan writes nothing to any graph.** Query with `file:...?mode=ro` where SQL is involved; prefer the existing node-reading path over new SQL if one exists.
- Three states, never two. This line of work has produced fifteen instances of a set treated as complete when a member is missing and eight of an instrument reporting a result it had not earned. Every quantity here has an unknown: a record with no workspace, no host name, no `price_known`, no `elapsed_ms`. `summariseObservations` (`budget.ts:118`) already counts `unnamedNode`, `unidentifiedRecords` and `priceUnknown` — follow that precedent rather than inventing a new one.
- Every JSON command exposes `ok`, `nextCommand`, `nextCommands`. Match the existing contract.
- Do not change what is WRITTEN onto a `BudgetObservation`. If a field you need is missing, that is a finding to report, not a field to add.
- Never run `refarm ask` — it spends the operator's real subscription quota. The 29 existing records are the fixture.
- Never run a bare `cargo test` (OOM risk, CLAUDE.md §7). Do not rebuild the WASM agent. Do not run any `diagrams:` script. Do not restart the operator's node.
- The new ratchet must not rise: `node scripts/no-os-resolution.mjs` is at 117, delta 0.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/refarm/src/commands/budget.ts` (530 lines) | Grouping, period filter, the subscription axis. | 1, 2 |
| `apps/refarm/src/commands/budget.test.ts` | Pure grouping, driven by literals. | 1, 2 |
| `docs/` | How to ask the three questions. | 3 |

---

### Task 1: Group by, with the unknown as a row

**Files:** `apps/refarm/src/commands/budget.ts`, its test

**Interfaces:**
- Produces `groupObservations(nodes, { by })` — PURE. `by` is `"workspace" | "host" | "spawner"`. Returns groups plus an explicit unattributed bucket, each carrying observation count, token totals (input, output, and the cache/reasoning breakdowns that already exist), and a dollar total that is `null` — not `0` — when every member is `subscription`.

Read `summariseObservations` (`budget.ts:118`) first and extend its vocabulary rather than parallel it. It already counts the unknowns; the grouping should report them the same way.

- [ ] **Step 1: Write the failing tests** with literal observation objects: three records in two workspaces plus two with no `refarm.workspace.id` → two groups plus an `(unattributed)` bucket of 2, never a total of 3; a group where every member is `subscription` reports `usd: null` not `0`; a group mixing `subscription` and a metered mode reports the metered sum and says how many members were excluded.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the pure function.
- [ ] **Step 4: Wire `refarm budget by-workspace|by-host|by-spawner --json`**, matching the existing command's `ok`/`nextCommand`/`nextCommands` contract.
- [ ] **Step 5: Run it live** against the operator's real 29 records and paste all three outputs. Expected from the measurement above: `refarm` 5, `rcdc5` 3, unattributed 21; spawner `refarm-ask` 22 and `capability-dispatch` 7. If your numbers disagree with these, **believe your measurement and report the disagreement** — mine came from a direct SQL read and yours comes through the command's own path, and a gap between them is information.
- [ ] **Step 6: Commit.**

---

### Task 2: The subscription axis

**Files:** `apps/refarm/src/commands/budget.ts`, its test

The operator's route is `openai-codex`, a subscription. His binding constraint is requests per billing period — a quota that REFILLS across runs, not a ceiling consumed within one. Every existing budget bound (`refarm.budget.max_usd`, `max_tokens`) measures within a single dispatch.

- [ ] **Step 1: Write the failing tests** for a pure `usageByPeriod(nodes, { period })` — records bucketed from `timestamp_ns`, counts and token sums per bucket, and a bucket boundary that a caller can state. Decide and document what a "period" means here: a rolling window, or a calendar boundary? A subscription quota refills on a billing date, so a rolling 30 days and a calendar month are different answers — pick one, say why, and make the other reachable rather than impossible.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, then wire `refarm budget usage --period <spec> --json`.
- [ ] **Step 4: Live** against the real record — the window is 03/08 21:21 → 05/08 17:29 with 590 output tokens, so a 30-day window should contain all 29 and a 1-day window should contain none. Paste both; the empty one is the more useful test.
- [ ] **Step 5:** Report what a period query CANNOT answer today — the record has no notion of the operator's actual billing date or quota size, so the command can count usage but cannot say "you have N left". Say that in the output rather than implying a ceiling that does not exist.
- [ ] **Step 6: Commit.**

---

### Task 3: Record it

**Files:** a doc (decide where and say why), `.project/handoff.json`

- [ ] Write how to ask the three questions — what did this workspace cost, what did this node cost, what have I used this period — with the real output.
- [ ] Record that dollars are `—` and not `$0.00` under subscription, and why that distinction was deliberate.
- [ ] Record the coverage numbers (8/29 attributed, 21/29 host-named) so the next reader knows the record is partial and does not read a total as complete.
- [ ] Record what this does NOT cover: work refarm did not dispatch. Carry the 590-vs-6.5M number — it is the argument for the ingestion slice.
- [ ] Strike loose-end #20; leave #21 open if the subscription axis only partly closes it, and say which part.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| Unattributed records are a row, never folded into a total | 1 |
| Dollars are `—` under subscription, not `$0.00` | 1 |
| Grouping extends `summariseObservations`' vocabulary rather than paralleling it | 1 |
| A period means one stated thing, and the other is reachable | 2 |
| The command says what it cannot answer | 2 |
| Coverage is recorded so a total is not read as complete | 3 |
| The 590-vs-6.5M gap is written down | 3 |

**Out of scope:** ingesting work refarm did not dispatch (the operator chose queries first, deliberately); any change to what is written onto an observation; the sandbox's missing `SovereignConfig` node, which is why its own observations lack `refarm.workspace.id` — queued separately.
