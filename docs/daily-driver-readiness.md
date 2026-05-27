# Refarm Daily Driver Readiness

This score is a pragmatic stop condition for making Refarm usable as an
operator-first daily driver before optimizing it for external users.

## Score

Target: **85/100** for daily use, **95/100** for selling the experience.

| Area | Weight | What counts |
| --- | ---: | --- |
| Runtime reliability | 20 | `runtime ensure`, `ask`, task dispatch, restart, and diagnostics recover without manual guessing. |
| Agent handoffs | 20 | Public JSON commands expose `ok`, `nextCommands`, recommendations, and process specs when external commands run. |
| Model routing | 15 | Defaults, scoped worker/monitor routes, credentials, fallback, and base URLs are inspectable and configurable. |
| Resume and observability | 15 | Operator can answer "where was I?" across runtime, tasks, models, sessions, logs, and finish gates. |
| Shared primitives | 15 | CLI contracts live in shared packages when reusable; the app layer keeps product commands and human UX. |
| Validation economy | 10 | `agent finish` chooses useful scoped checks and keeps expensive validation intentional. |
| Documentation continuity | 5 | Essential operator flows and architecture boundaries are captured in repo docs. |

## Current Working Estimate

**78/100**

Strong enough to keep developing with Refarm in the loop, not yet strong enough
to stop spending regular work on Refarm itself.

What is already solid:

- `refarm agent finish` gives a repeatable end-of-slice gate.
- Runtime recovery commands and `nextCommands` exist across the main workflows.
- Model defaults, scoped routes, and credential gaps are visible.
- Task logs and resume now preserve model-route context.
- Package-manager-sensitive commands are becoming structured and spawn-safe.
- `@refarm.dev/cli` owns status, browser-open, command-line parsing, handoff
  command helpers, JSON output envelopes, command result parsing, and command
  plan execution/envelopes.
- Execution-plan readiness/handoffs and host action affordance selection now
  live in `@refarm.dev/cli` with agnostic primary names and Refarm aliases
  where compatibility is still useful.

What still blocks the 85/100 target:

- Some scripts and legacy toolbox flows still execute shell command strings.
- Resume is still task-centric; operator-level resume/status needs a single
  daily-driver view.
- `agent finish` can be faster and more selective for common local edits.
- The core operator workflow needs one short maintained guide.

## Boundary Rule

- `apps/refarm`: product commands, human output, final CLI UX.
- `packages/cli`: reusable CLI primitives, JSON envelopes, handoff commands,
  command plans, execution plans, action affordances, process specs, status
  schemas.
- `packages/config`: defaults, provider/model/package-manager policy.
- `farmhand`, runtime, tractor: execution, state, task/plugin lifecycle,
  sandboxing, logs, and recovery behavior.
