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
| Shared primitives | 15 | CLI contracts live in shared packages when reusable; the app layer keeps product commands and operator UX. |
| Validation economy | 10 | `agent finish` chooses useful scoped checks and keeps expensive validation intentional. |
| Documentation continuity | 5 | Essential operator flows and architecture boundaries are captured in repo docs. |

## Current Working Estimate

**79/100 for total operator migration**

Strong enough to keep using Refarm to harden Refarm, but not yet strong enough
to make it the only operator surface for all work without frequent expert
intervention.

This score tracks a strict question: "Can the operator migrate fully and spend
most work on non-Refarm tasks while Refarm still operates and recovers itself?"

What is already solid:

- `refarm agent finish` gives a repeatable end-of-slice gate with lane
  selection, `affected` profile detecting changed workspaces and script checks,
  and `--run --json` for automated execution.
- `refarm resume` is the canonical first diagnostic: priority-aware
  `nextCommands` (emergency → runtime only; recovery → finish first; normal →
  session + task), `failedCommand` and remaining count visible in operator
  output, and a shared `@refarm.dev/cli` resume envelope.
- `refarm ask --json` success path now emits `nextCommands` with `resume`,
  session show, and `agent finish --lane after-edit` as the natural continuation
  — the agent loop is now self-guiding from ask through validation.
- All handoff command strings in the agent plan use `refarmCommand` or exported
  constants — no more hardcoded inline strings in nextCommands or data fields.
  The `actionCommand` field pattern is now guarded by the boundary test.
- `sow --json` already-configured path now emits `check` and `model current` as
  next steps instead of returning empty nextCommands.
- The full operator loop is now self-guiding: `ask --json` success → resume +
  session show + after-edit finish; `agent finish --run --json` pass → resume;
  `task status` done → logs + resume; `tidy imports --json` success → resume
  (or after-edit finish for `--check` pass); `runtime ensure --json` ready →
  resume. Terminal states across all major commands now point back to the
  canonical operator view.
- Runtime recovery commands and `nextCommands` exist across the main workflows.
- Model defaults, scoped routes, and credential gaps are visible; `nextCommands`
  surfaces model inspect only when credentials are missing, not on every resume.
- Task logs and resume preserve model-route context.
- Package-manager-sensitive commands are structured and spawn-safe.
- `@refarm.dev/cli` owns status, browser-open, command-line parsing, handoff
  command helpers, JSON output envelopes, command result parsing, command plan
  execution/envelopes, launch process specs, detached process launch, launch
  readiness policy, Git command helpers, GitHub Actions CLI adapters, resume
  envelope, and execution-plan readiness/handoffs.
- Host action affordance selection lives in `@refarm.dev/cli` with agnostic
  primary names; `nextAction/nextActions/nextCommand/nextCommands` appear on
  surface-action dry-run envelopes.
- `apps/refarm` is guarded against direct `node:child_process` imports, direct
  hardcoded package-manager execution, and legacy `RefarmAction*` aliases.
- Public JSON contract tests cover all major commands including `ask` error
  paths, confirming `nextActions`, `nextCommands`, and template metadata.
- `refarm:agent:e2e:mock` exercises runtime start, pi-agent, `ask --json`,
  stream-file creation, and OpenAI-compatible request capture against
  `@refarm.dev/model-mock` without Ollama or paid model tokens.
- Runtime/model bridge deltas in `ask`, `pi-agent`, `model-mock`, and Tractor
  WASI LLM routing are now routed to that no-token e2e smoke by
  `refarm agent finish --profile affected` and the host smoke auto profile
  `agent-e2e-mock`.
- The short daily-driver operator loop is maintained in
  `docs/REFARM_OPERATOR_DAILY_DRIVER.md`.

What still blocks the 95/100 product target:

- Some scripts and legacy toolbox flows still execute shell command strings.
- Remaining direct app prompts are expected to go through
  `@refarm.dev/prompt-contract-v1`; legacy `ExitPromptError` cancellation is
  recognized by shape for compatibility without a direct app dependency.
- `agent finish` can be faster and more selective for common local edits.
- The interactive TUI/Web operator surfaces still need more runtime controls.

What blocks primary daily-driver migration:

- The actual operator loop (`runtime up → ask → session → resume → finish`) has
  not been exercised end-to-end as a daily driver. The control plane is solid;
  the execution plane reliability is unknown until used.
- Runtime provider switching, login, and scoped model changes still need a
  smoother non-interactive loop.
- The app has correctly acted as the proving ground, but mature contracts must
  continue moving down into shared packages once a second consumer or repeated
  product flow proves reuse.

## Migration Gates

Use these gates as the stop condition before the operator depends on Refarm as
the primary daily driver:

1. Resume gate: `refarm resume --json` can explain the current runtime, active
   session, recent task, model route, and last finish result with executable
   `nextCommands`. ✅ Priority-aware; failedCommand and remaining count visible.
2. Finish gate: `refarm agent finish --lane after-edit --run --json` and
   `after-commit` pass reliably for small slices without manual command
   selection. ✅ Lanes solid; affected profile includes script checks.
3. Handoff gate: `refarm agent finish --lane handoffs --run --json` passes
   after public JSON output changes and catches placeholders, REPL-only
   commands, and missing template metadata. ✅ Contract tests cover all major
   commands including `ask`.
4. Model gate: `refarm model current --json`, `refarm model providers --json`,
   and `refarm sow --model <provider/model>` provide enough state and recovery
   commands to fix credentials or switch to a no-key local route. ✅ Solid.
5. Runtime gate: `refarm runtime ensure --wait`, `runtime doctor
   --next-command`, and `check --next-action --json` converge without requiring
   undocumented manual steps. ✅ Solid.
6. Boundary gate: new reusable command/process/env/prompt contracts live in
   `packages/*`; `apps/refarm` keeps product orchestration and operator UX.
   🔄 In progress — boundary guards are active; primitives continue moving down
   as repeated use proves the boundary.

## Next Hardening Order

1. End-to-end loop validation: exercise `runtime up → ask → session → resume →
   finish` as an actual operator slice and fix what breaks. Start with
   `refarm:agent:e2e:mock` or
   `npm run refarm:host:smoke:auto:agent-e2e-mock` for the no-token
   execution-plane gate, then run live provider checks only when explicitly
   needed.
2. Runtime recovery: surface `nextCommand` through more failure paths in the
   actual runtime start/ensure flow.
3. Model and credential operations: make provider/model/login changes
   non-interactive where possible and resumable where not.
4. Primitive extraction: move repeated contracts down only after repeated app
   use proves the boundary.

## Boundary Rule

- `apps/refarm`: product commands, operator output, final CLI UX.
- `packages/cli`: reusable CLI primitives, JSON envelopes, handoff commands,
  command plans, execution plans, action affordances, launch process specs,
  detached process launch, launch readiness policy, Git command helpers, GitHub
  Actions CLI adapters, status schemas, resume envelope.
- `packages/config`: defaults, provider/model/package-manager policy.
- `farmhand`, runtime, tractor: execution, state, task/plugin lifecycle,
  sandboxing, logs, and recovery behavior.
