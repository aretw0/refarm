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

**82/100 for assisted daily use**

Strong enough to keep using Refarm to harden Refarm through the self-guiding
operator loop, but not yet strong enough to make it the only operator surface
for all work without frequent expert intervention.

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
- `refarm:agent:e2e:mock` exercises runtime start, the runtime agent,
  `plugin reload runtime-agent --json`,
  `ask --json`, `task run runtime-agent respond --transport http --json`,
  `task resume --json`, top-level `resume --json`, stream-file creation,
  executable task status/log handoffs, and OpenAI-compatible request capture
  against `@refarm.dev/model-mock` without Ollama or paid model tokens.
- Runtime/model bridge deltas in `ask`, the runtime agent, `model-mock`, and Tractor
  WASI LLM routing are now routed to that no-token e2e smoke by
  `refarm agent finish --profile affected` and the host smoke auto profile
  `agent-e2e-mock`.
- `refarm agent --json` exposes the no-token `agent-e2e-mock` lane directly in
  `nextActions` and `nextCommands`, so agents do not need to discover it only
  from nested lane metadata.
- `refarm resume --json` and `refarm agent --json` both expose
  `refarm model doctor --json`, so local-provider diagnosis is discoverable
  from the two main operator handoffs without making `resume` perform a live
  provider probe.
- Runtime-agent prompt identity now uses the product concept
  "Refarm runtime agent"; the physical `@refarm/pi-agent` package remains a
  compatibility identity rather than the operator-facing semantic center.
- Session participants now expose the same boundary: legacy
  `urn:refarm:agent:pi-agent` data is preserved for history, while
  `canonicalParticipants` and `participantAliases` surface
  `urn:refarm:agent:runtime-agent` in both `sessions show --json` and
  `resume --json`.
- `refarm task resume --json` is now the preferred continuation when a task
  checkpoint exists; it carries the current effort handoffs, model inspection
  command, and status/log commands. `task list --json` remains the inventory
  view when no checkpoint is available or the operator wants broader history.
- `refarm tree show <session> --json` closes back to `refarm resume --json`, so
  the normal resume → inspect timeline → resume → task checkpoint loop no longer
  relies on hidden operator memory.
- The short daily-driver operator loop is maintained in
  `docs/REFARM_OPERATOR_DAILY_DRIVER.md`.
- The primitive contract map is maintained in
  `docs/OPERATOR_PRIMITIVES.md`.

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
- The first external-repo attempt targeted `agents-lab`. It exposed a host
  bootstrap gap before any model work ran: the Windows host had no `refarm`
  command in `PATH`, direct `node apps/refarm/dist/index.js` did not resolve
  workspace dependencies, and host `node_modules` reparse points were
  container-oriented. The host shim now reaches the CLI and `resume --json`
  works in `agents-lab`. The compact readiness handoff is now usable there:
  `check --next-action --json` deduplicates repeated policy diagnostics and
  points first to `refarm health --suggest-policy --json`. The remaining blocker is
  repo-local calibration for generated docs, skill packages, and runtime
  readiness; external daily-driver use needs a checked-in `health` policy in
  each consumer repo or a dedicated external-workspace profile.
- Runtime provider switching, login, and scoped model changes still need a
  smoother non-interactive loop.
- The app has correctly acted as the proving ground, but mature contracts must
  continue moving down into shared packages once a second consumer or repeated
  product flow proves reuse.
- External consumers (`agents-lab`, `vault-seed`, and future operator shells)
  need adapter-level interfaces, not direct imports of Refarm app or engine
  internals. The next maturity step is making that boundary boring enough that
  Refarm can power them without centralizing every workflow in `apps/refarm`.

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
7. Consumer gate: independent consumers can depend on stable interfaces or
   adapters without importing the Refarm runtime directly. 🔄 In progress —
   roadmap consumers are mapped; extraction remains gated by real repeated use.

## Next Hardening Order

Use this order to decide whether work belongs lower in shared primitives,
higher in operator UX, or outside Refarm entirely:

1. **Execution breakage first**: if runtime, task, model, or finish execution
   fails, harden the lowest layer that owns the failure. Do not patch only the
   visible CLI wording unless the underlying primitive is already sound.
2. **Handoff ambiguity second**: if the system works but the next step is
   unclear, fix the JSON contract or documentation at the first public handoff
   the agent sees (`resume`, `agent --json`, `check`, `task resume`, or
   `model doctor`).
3. **Boundary pressure third**: if two commands or a second consumer need the
   same behavior, move it down into `packages/*`; otherwise keep
   product-specific orchestration in `apps/refarm` until reuse is real.
4. **Migration pressure next**: when the loop is green, prefer using Refarm on
   non-Refarm work over adding more self-hardening. New internal work should be
   justified by a real failure, a repeated primitive, or a public contract gap.
5. **Product polish last**: improve TUI/Web/operator comfort after the CLI loop
   is already able to recover itself through JSON handoffs.

Current priority sequence:

1. End-to-end loop validation: keep exercising `runtime up → ask → session →
   resume → finish` as actual operator slices and fix what breaks. Start with
   `refarm agent finish --lane agent-e2e-mock --run --json` for the no-token
   execution-plane gate, then run live provider checks only when explicitly
   needed.
2. External consumer calibration: use `refarm health --policy --json` to inspect
   the effective policy and `refarm health --suggest-policy --json` to generate
   a reviewed candidate `health` block before tuning `refarm.config.json` in
   non-Refarm repos. If the candidate is correct, apply it explicitly with
   `refarm health --apply-suggested-policy --json`; then rerun
   `refarm check --next-action --json` until the remaining handoff is runtime
   or task-specific rather than workspace-policy noise.
3. Runtime recovery: surface `nextCommand` through more failure paths in the
   actual runtime start/ensure flow.
4. Model and credential operations: make provider/model/login changes
   non-interactive where possible and resumable where not.
5. Primitive extraction: move repeated contracts down only after repeated app
   use proves the boundary.

## Anti-Centralization Checkpoint

Run this checkpoint before starting another Refarm-internal hardening slice.
The goal is to keep `apps/refarm` as the cockpit, not the gravity well.

Proceed with internal Refarm work only when the slice answers at least one
question with evidence:

| Question | If yes | Owning layer |
| --- | --- | --- |
| Did an execution path fail? | Fix the runtime, task, model, or finish layer that owns the failure. | `farmhand`, runtime, Tractor, runtime agent, or model bridge |
| Did a handoff mislead the operator? | Fix the first public JSON surface the agent sees. | `@refarm.dev/cli` or `apps/refarm` |
| Did two commands need the same behavior? | Extract the shared primitive. | `packages/*` |
| Did a second repo need the behavior? | Add an adapter or policy boundary instead of importing app internals. | shared package or consumer adapter |
| Is this only comfort/polish? | Defer until the CLI loop has real daily-driver mileage. | app UX later |

If none of those is true, the next slice should be a migration-pressure slice:
use Refarm on non-Refarm work, record the observed failure, and harden only the
lowest layer that failed. A green `resume`, `check`, `after-edit`, and
`handoffs` sequence is a signal to leave self-work and gather external evidence.

## Migration Decision Rule

The current control plane is strong enough for assisted daily-driver use, but
not enough to justify endless self-hardening before it sees real work. After a
green `after-edit` gate and a green `handoffs` gate, the next useful signal
should come from operating a non-Refarm task through the same loop.

Treat new Refarm-internal work as justified only when one of these is true:

- an actual operator slice fails and the missing primitive is clear;
- a second consumer needs a boundary that currently lives inside `apps/refarm`;
- a public JSON handoff becomes ambiguous, non-executable, or misleading;
- runtime/model/task behavior changes under the existing daily-driver path.

Otherwise, prefer migration pressure over more app work: use Refarm to operate
another repo or workflow, record the failure mode, then harden the lowest layer
that owns the repeated primitive. This keeps `apps/refarm` as the cockpit rather
than the center of every future workflow.

## Boundary Rule

- `apps/refarm`: product commands, operator output, final CLI UX.
- `packages/cli`: reusable CLI primitives, JSON envelopes, handoff commands,
  command plans, execution plans, action affordances, launch process specs,
  detached process launch, launch readiness policy, Git command helpers, GitHub
  Actions CLI adapters, status schemas, resume envelope.
- `packages/config`: defaults, provider/model/package-manager policy.
- `farmhand`, runtime, tractor: execution, state, task/plugin lifecycle,
  sandboxing, logs, and recovery behavior.
