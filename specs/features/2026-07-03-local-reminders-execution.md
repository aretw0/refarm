# Spec: Local Reminders Execution (Daily-Driver Parity — "Automate reminders")

**Status:** IMPLEMENTED CANDIDATE - tick helper, engine-level fire-once ledger, `.refarm/`-backed ledger store, project `trigger()` adapter, and composable tick (`@refarm.dev/cli` `runDueScheduledWork`) shipped; operator command + farmhand daemon wiring pending
**Authors:** Claude (draft from 2026-07-03 audit), pending Arthur Silva review
**Date:** 2026-07-03
**Related:** `docs/DAILY_DRIVER_PARITY.md` (Minimum Daily Loop row "Automate reminders"),
`docs/superpowers/specs/2026-05-17-automation-contract-v1-design.md`,
`packages/automation-contract-v1`, `packages/windmill/src/local-scheduler.js`,
`packages/cli/src/project-automations.ts`, `.project/automations.json`

---

## Context

The parity row requires: *"one-shot and recurring reminders run locally with clear ownership"*.
The row is open, but the substrate is mostly built — this spec closes a **gap**, it does not
start a lane:

| Piece | State | Evidence |
| --- | --- | --- |
| Trigger types (`CronTrigger`, `OneShotTrigger`) | shipped | `packages/automation-contract-v1/src/types.ts:52-77` |
| Automation lifecycle (`draft → ready → active → archived`), `trigger()` → `Effort` | shipped | automation-contract-v1 design doc |
| Due-ness computation (`list`/`inspect`/`due`) | shipped, **inspection-only** | `packages/windmill/src/local-scheduler.js:172-220` |
| Operator visibility of scheduled work | shipped | `refarm resume` via `packages/cli/src/operator-resume.ts` + `project-automations.ts` |
| Automation store (declared intent, shared with `pi`) | shipped | `.project/automations.json` |
| Execution: something that fires due triggers | shipped as package helper | `packages/windmill/src/local-scheduler.js` exports `executeDueLocalScheduledWork()` |
| Fire-once idempotency (engine) | shipped | `executeDueLocalScheduledWork` takes an optional `hasFired`/`recordFired` ledger; per-job/per-window fire key; commit `187c3a29` |
| `.refarm/` fired ledger store | shipped | `@refarm.dev/windmill/local-scheduler-ledger` defaults to `.refarm/scheduler/ledger.json` |
| Project `AutomationAdapter.trigger()` | shipped | `@refarm.dev/cli/project-automations` exports `createProjectAutomationAdapter()` over `.project/automations.json` |
| Composable tick (project adapter + `.refarm/` ledger + injected effort adapter) | shipped | `@refarm.dev/cli` exports `runDueScheduledWork()`; commit `a23695fc` |

Everything up to the tick is now a package block: `runDueScheduledWork()` composes the project
automation adapter (query + trigger over `.project/`), the `.refarm/` fired ledger, and an injected
effort submit adapter, driven by `executeDueLocalScheduledWork()`. It is proven end to end against a
temp `.project/` + `.refarm/` — a due one-shot fires once, persists to the ledger, and a fresh call
(only the persisted ledger connecting them, like a daemon restart) does not re-fire. The remaining
daily-driver gap is (a) an operator command that calls `runDueScheduledWork()` (dogfood/manual tick)
and (b) farmhand daemon wiring that calls the same helper from its lifecycle loop with the real
transport as the effort adapter.

## Decisions

1. **Farmhand owns the tick.** The automation design doc already names the caller: *"The caller
   (farmhand, runtime, CLI) submits the returned Effort to the effort adapter — the two contracts
   are independent and connected only by the caller."* The composition is now a single call —
   `@refarm.dev/cli` `runDueScheduledWork()` — that farmhand invokes from its lifecycle loop with
   the real transport as the effort adapter. No new authority, no new daemon, no new package —
   composition of shipped blocks.
2. **Fire-once ledger for one-shot triggers.** A fired one-shot records `firedAt` (and the
   producing effort id) in a **runtime ledger under `.refarm/`** (e.g.
   `.refarm/scheduler/ledger.json`), keyed by a stable per-job/per-window fire key; an
   already-fired key is never re-fired, and the automation transitions to `archived` after its
   effort completes. The ledger lives in `.refarm/` — not in `.project/automations.json` —
   because fired state is per-machine runtime, and `.project/` is a **shared, versioned surface
   also written by the `pi` agent's `pi-project-workflows`**. Keeping the ledger out of the
   automation artifact avoids polluting the interoperable project contract with refarm-only
   runtime state and avoids write contention with pi. The ledger survives daemon restarts because
   `.refarm/` is durable local state. `@refarm.dev/windmill/local-scheduler-ledger` supplies the
   `.refarm/scheduler/ledger.json` adapter for hosts that want the default local runtime store.
3. **Project store trigger adapter.** `@refarm.dev/cli/project-automations` supplies
   `createProjectAutomationAdapter()` for hosts that need to bridge `.project/automations.json` to
   the Windmill scheduler. It can query active scheduled automations and trigger active records
   into ready-to-submit Efforts. Static, template, and default bodies are executable now; plugin
   bodies fail explicitly until a host plugin adapter is wired.
4. **Missed-window policy.** One-shot: fire late, once (a reminder is still owed). Cron: skip
   missed windows, fire at the next due window (no catch-up storms). Both policies are recorded
   on the effort evidence so late fires are distinguishable.
5. **Reminder delivery is an Effort, not a channel call.** The fired Effort lands in the operator
   loop: `refarm resume --json` / `refarm check --next-action --json` surface it (surface already
   proven). Channel delivery (Telegram etc.) stays out of scope; when wanted later it composes
   with `channel-policy-v1` evidence, keeping provider APIs downstream.
6. **Operator sugar, thin.** `refarm remind "<text>" --at <iso>` / `--cron "<expr>"` creates an
   `active` Automation with the matching trigger. It is a convenience writer over the existing
   project-automations surface — no new semantics.

## Proof (parity row signal)

The row closes when this runs locally, end to end:

Package signal:

```bash
pnpm -C packages/windmill run test -- local-scheduler
pnpm -C packages/windmill run test -- local-scheduler-ledger
pnpm -C packages/cli run test -- project-automations
```

Daily-driver row still closes only when this runs locally, end to end:

1. `refarm remind "one-shot proof" --at <now+1min>` → farmhand tick fires it once → effort
   visible in `refarm resume --json`; the `.refarm/` runtime ledger records the fire key with
   `firedAt`; daemon restart does not re-fire.
2. A cron automation (`*/5 * * * *`) fires on two consecutive windows; a stopped window is
   skipped, not replayed.
3. Ownership is answerable in one sentence: *farmhand ticks, local-scheduler decides due-ness,
   automation-contract produces the Effort, the operator loop shows it.*

## Non-goals

- Cloud/Windmill-server parity, external queues, or wall-clock precision below the tick interval.
- Provider delivery (Telegram/mail); `vault-seed` outbox UX stays downstream (ADR boundary).
- UI surfaces; `apps/me` consumption is a later consumer of the same efforts.

## Open questions for review

- Tick interval default (60s?) and whether the tick runs only while farmhand runs (accepted
  limitation of a local-first daily driver) or also on `refarm resume` as a catch-up sweep.
- Whether `refarm remind` writes require the same serialized handoff policy as other
  `.project/**` writers. Leaning **yes**: `.project/` is a surface the `pi` agent also writes via
  `pi-project-workflows`, so a reminder writer must respect the serialized-handoff discipline
  (CLAUDE.md §8) to avoid contending with pi. This is a further reason the runtime fired-ledger
  lives in `.refarm/` (refarm-sovereign, unshared) rather than in the `.project/` artifact.
- **Ledger retention.** `.refarm/scheduler/ledger.json` grows one entry per fired key and is not
  yet pruned; a `*/5 * * * *` cron adds ~288 entries/day (one per window). Options: prune cron
  windows older than N days on write, cap entries, or archive one-shots once their automation is
  `archived`. Deferred until the farmhand tick wiring lands (the write site that would prune) — the
  in-memory bound is not a daily-driver blocker but should not grow forever.
- **Ledger concurrency.** `recordFired` is read-modify-write over the whole file (atomic rename, so
  never corrupt, but last-write-wins across concurrent writers). Fine for the single local daemon
  that ticks sequentially; a multi-writer setup (daemon + a concurrent CLI tick) would drop one of
  two simultaneous records. Revisit only if a second concurrent ticker is introduced.
