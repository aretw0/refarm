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

**92/100**

Strong enough to use Refarm as the daily development driver while still
spending regular work on hardening Refarm itself.

What is already solid:

- `refarm agent finish` gives a repeatable end-of-slice gate.
- Runtime recovery commands and `nextCommands` exist across the main workflows.
- Model defaults, scoped routes, and credential gaps are visible.
- Task logs and resume now preserve model-route context.
- Package-manager-sensitive commands are becoming structured and spawn-safe.
- `@refarm.dev/cli` owns status, browser-open, command-line parsing, handoff
  command helpers, JSON output envelopes, command result parsing, and command
  plan execution/envelopes. Command handoff now exposes agnostic binary command
  construction while keeping Refarm-specific helpers as compatibility wrappers.
- `@refarm.dev/cli` also owns launch process specs, detached process launch,
  launch readiness policy, and launcher command parsing, while app commands keep
  product-specific launch modes and renderer behavior. The launch policy exposes
  agnostic primary names with Refarm aliases where compatibility is useful.
- Git command execution helpers now live in `@refarm.dev/cli`; tree and finish
  flows keep their product policy in `apps/refarm` while sharing the same Git
  process boundary.
- GitHub Actions secret writes now use a shared `@refarm.dev/cli` adapter for
  `gh secret set`, keeping provision commands focused on product orchestration.
- Execution-plan readiness/handoffs and host action affordance selection now
  live in `@refarm.dev/cli` with agnostic primary names and Refarm aliases
  where compatibility is still useful.
- `apps/refarm` is guarded against direct `node:child_process` imports, direct
  hardcoded package-manager execution, and internal use of legacy
  `RefarmAction*` aliases. Process and package-manager execution must route
  through shared adapters/resolvers.
- `refarm resume` now provides an operator-level runtime, active-session,
  recent-session, recent-prompt, finish-gate, and worker checkpoint view backed
  by a shared `@refarm.dev/cli` resume envelope.
- Model credential provider selection, init template selection, GitHub owner
  text prompts, migrate target URL prompts, OAuth text prompts, and secret
  credential entry now route through the shared
  `@refarm.dev/prompt-contract-v1` operator channel instead of command-local
  prompt libraries.
- The short daily-driver operator loop is maintained in
  `docs/REFARM_OPERATOR_DAILY_DRIVER.md`.

What still blocks the 95/100 product target:

- Some scripts and legacy toolbox flows still execute shell command strings.
- Remaining direct app prompts are now expected to go through
  `@refarm.dev/prompt-contract-v1`; legacy `ExitPromptError` cancellation is
  recognized by shape for compatibility without a direct app dependency.
- Operator resume can still grow deeper session-entry summaries, but already
  exposes recent runtime sessions and recovery commands.
- `agent finish` can be faster and more selective for common local edits.
- The interactive TUI/Web operator surfaces still need more runtime controls.

## Boundary Rule

- `apps/refarm`: product commands, human output, final CLI UX.
- `packages/cli`: reusable CLI primitives, JSON envelopes, handoff commands,
  command plans, execution plans, action affordances, launch process specs,
  detached process launch, launch readiness policy, Git command helpers, GitHub
  Actions CLI adapters, status schemas.
- `packages/config`: defaults, provider/model/package-manager policy.
- `farmhand`, runtime, tractor: execution, state, task/plugin lifecycle,
  sandboxing, logs, and recovery behavior.
