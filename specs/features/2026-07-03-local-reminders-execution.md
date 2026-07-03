# Spec: Local Reminders Execution (Daily-Driver Parity — "Automate reminders")

**Status:** IMPLEMENTED CANDIDATE - tick helper shipped; fire-once ledger and farmhand wiring pending
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
| Automation store | shipped | `.project/automations.json` |
| Execution: something that fires due triggers | shipped as package helper | `packages/windmill/src/local-scheduler.js` exports `executeDueLocalScheduledWork()` |

The first missing piece is now closed at package level: a host can call
`executeDueLocalScheduledWork()` to decide due-ness, call `AutomationAdapter.trigger()`, and submit
the returned Effort. The remaining daily-driver gap is durable one-shot firing state plus farmhand
daemon wiring.

## Decisions

1. **Farmhand owns the tick.** The automation design doc already names the caller: *"The caller
   (farmhand, runtime, CLI) submits the returned Effort to the effort adapter — the two contracts
   are independent and connected only by the caller."* `windmill/local-scheduler` now exposes the
   host-owned tick helper; farmhand still needs to call it from its lifecycle loop. No new
   authority, no new daemon, no new package — composition of shipped blocks.
2. **Fire-once ledger for one-shot triggers.** A fired one-shot records `firedAt` (and the
   producing effort id) in the automation artifact; a fired artifact is never re-fired and
   transitions to `archived` after its effort completes. The ledger lives in the artifact itself
   (`.project/automations.json`), so it survives daemon restarts.
3. **Missed-window policy.** One-shot: fire late, once (a reminder is still owed). Cron: skip
   missed windows, fire at the next due window (no catch-up storms). Both policies are recorded
   on the effort evidence so late fires are distinguishable.
4. **Reminder delivery is an Effort, not a channel call.** The fired Effort lands in the operator
   loop: `refarm resume --json` / `refarm check --next-action --json` surface it (surface already
   proven). Channel delivery (Telegram etc.) stays out of scope; when wanted later it composes
   with `channel-policy-v1` evidence, keeping provider APIs downstream.
5. **Operator sugar, thin.** `refarm remind "<text>" --at <iso>` / `--cron "<expr>"` creates an
   `active` Automation with the matching trigger. It is a convenience writer over the existing
   project-automations surface — no new semantics.

## Proof (parity row signal)

The row closes when this runs locally, end to end:

Package signal:

```bash
pnpm -C packages/windmill run test -- local-scheduler
```

Daily-driver row still closes only when this runs locally, end to end:

1. `refarm remind "one-shot proof" --at <now+1min>` → farmhand tick fires it once → effort
   visible in `refarm resume --json`; artifact carries `firedAt`; daemon restart does not re-fire.
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
  `.project/**` writers.
