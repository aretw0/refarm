# Refarm Daily Driver Readiness

This score is a pragmatic stop condition for making Refarm usable as an
operator-first daily driver before optimizing it for external users.

## Score

Target: **80/100** for assisted daily use, **85/100** for primary daily use,
and **95/100** for selling the experience.

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

**72/100 for total operator migration**

Strong enough to keep using Refarm to harden Refarm, but not yet strong enough
to make it the only operator surface for all work without frequent expert
intervention.

The previous score was tracking local self-development momentum. This score
tracks a stricter question: "Can the operator migrate fully and spend most work
on non-Refarm tasks while Refarm still operates and recovers itself?"

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
  current-model-route, recent-session, recent-prompt, finish-gate, and worker
  checkpoint view backed by a shared `@refarm.dev/cli` resume envelope.
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

What blocks primary daily-driver migration:

- `refarm resume` needs to become the canonical first diagnostic for every
  interrupted slice, including clearer links between the last finish failure,
  recent task checkpoints, model route, and runtime readiness.
- Public JSON command contracts need wider conformance tests beyond the current
  high-value handoff surfaces.
- Runtime recovery needs fewer paths that rely on the operator remembering
  which low-level command to run next.
- The model/credential path is inspectable, but runtime provider switching,
  login, and scoped model changes still need a smoother non-interactive loop.
- The app has correctly acted as the proving ground, but mature contracts must
  continue moving down into shared packages once a second consumer or repeated
  product flow proves reuse.

## Migration Gates

Use these gates as the stop condition before the operator depends on Refarm as
the primary daily driver:

1. Resume gate: `refarm resume --json` can explain the current runtime, active
   session, recent task, model route, and last finish result with executable
   `nextCommands`.
2. Finish gate: `refarm agent finish --lane after-edit --run --json` and
   `after-commit` pass reliably for small slices without manual command
   selection.
3. Handoff gate: `refarm agent finish --lane handoffs --run --json` passes
   after public JSON output changes and catches placeholders, REPL-only
   commands, and missing template metadata.
4. Model gate: `refarm model current --json`, `refarm model providers --json`,
   and `refarm sow --model <provider/model>` provide enough state and recovery
   commands to fix credentials or switch to a no-key local route.
5. Runtime gate: `refarm runtime ensure --wait`, `runtime doctor
   --next-command`, and `check --next-action --json` converge without requiring
   undocumented manual steps.
6. Boundary gate: new reusable command/process/env/prompt contracts live in
   `packages/*`; `apps/refarm` keeps product orchestration and human UX.

## Next Hardening Order

1. Resume and observability: make `refarm resume --json` the richest, safest
   continuation point.
2. Public JSON conformance: broaden contract tests for commands that an agent
   will execute as handoffs.
3. Runtime recovery: reduce "know this command" gaps by threading
   `nextCommand` through failures.
4. Model and credential operations: make provider/model/login changes
   non-interactive where possible and resumable where not.
5. Primitive extraction: move repeated contracts down only after repeated app
   use proves the boundary.

## Boundary Rule

- `apps/refarm`: product commands, human output, final CLI UX.
- `packages/cli`: reusable CLI primitives, JSON envelopes, handoff commands,
  command plans, execution plans, action affordances, launch process specs,
  detached process launch, launch readiness policy, Git command helpers, GitHub
  Actions CLI adapters, status schemas.
- `packages/config`: defaults, provider/model/package-manager policy.
- `farmhand`, runtime, tractor: execution, state, task/plugin lifecycle,
  sandboxing, logs, and recovery behavior.
