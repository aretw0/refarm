# Refarm Operator Primitives

Status: maintained contract map for the agentic daily-driver path.

This document defines the primitives that must stay boring before Refarm becomes
the operator's primary daily driver. It is intentionally narrower than the
architecture docs: it captures what an agent can rely on when it is driving
Refarm through JSON handoffs.

## Layer Rule

`apps/refarm` is the cockpit. It can compose commands, render operator output,
and choose product defaults. It should not become the permanent home for every
contract an agent needs.

Durable behavior should move down when a second command, package, surface, or
external consumer needs it:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `apps/refarm` | Product CLI UX, command composition, help text, operator recovery wording. | Reusable process execution, shared JSON envelopes, task/runtime state machines. |
| `packages/cli` | Handoff strings, command plans, process specs, resume envelopes, status/action schemas, launch helpers. | Runtime execution or plugin lifecycle internals. |
| `packages/config` | Stable IDs, aliases, defaults, provider and package-manager policy. | Operator presentation. |
| `apps/farmhand` | Task execution, plugin lifecycle coordination, runtime-facing execution behavior. | CLI-only wording or Commander-specific parsing. |
| `packages/tractor` | Runtime, plugin host, streams, sandbox boundary, runtime diagnostics. | Product command orchestration. |
| `packages/pi-agent` | Runtime-agent behavior and WASM contract. | Product-wide "PiAgent" semantics. |

## Public Handoff Contract

Every public JSON command used by an agent should expose:

- `ok`: whether the command reached the intended state.
- `command` and `operation`: stable identifiers for the invoked surface.
- `nextCommand`: the first executable continuation, or `null` for terminal
  success.
- `nextCommands`: ordered executable continuations. Empty means no recovery or
  continuation is required.
- `nextProcesses`: structured executable continuations when the command already
  knows the process boundary (`command`, `args`, optional `cwd`, and `display`).
  Prefer this field for agent runners; keep `nextCommands` as the stable
  shell-ready display/backcompat contract.
- `nextAction` and `nextActions`: user-facing action aliases that mirror the
  command contract when appropriate.
- `recommendations`: diagnostics with concrete commands when recovery requires
  explanation.

Executable handoffs must not contain placeholders, REPL-only commands, package
manager-specific variants that depend on hidden state, or commands that require
interactive secret entry without saying so.

## Core Primitives

### Resume

Purpose: answer "where was I?" before dispatching new work.

Required signals:

- Runtime readiness and selected engine.
- Current model route and credential state.
- Active and recent sessions with `sessions show` handoffs.
- Recent task checkpoint and effort status/log handoffs.
- Last finish gate, failed command, and remaining validation commands.

Start every agent slice with:

```bash
refarm resume --json
refarm check --next-action --json
```

If `resume` returns `nextCommands`, follow the first command before inferring
state from memory.

### Session

Purpose: preserve the operator timeline and make agent output inspectable.

Rules:

- `sessions show <id> --json` is terminal when the session is already active.
- `sessions list --json` should not suggest stale active-session recovery.
- New runtime-agent sessions should identify the participant as
  `urn:refarm:agent:runtime-agent`.
- Historical `urn:refarm:agent:pi-agent` participants and `[pi-agent ...]`
  entries are compatibility data, not the product-facing concept.

### Task And Effort

Purpose: dispatch resumable work without hiding state in the CLI process.

Rules:

- `task resume --json` is the preferred continuation when a checkpoint exists.
- Terminal or failed old efforts must not produce misleading resume handoffs.
- `task status --json` should distinguish active, done, failed, and unknown
  states with log and resume handoffs.
- `task logs --json` should be inspectable after terminal states.
- Operator-facing runtime-agent dispatch uses:

```bash
refarm task run runtime-agent respond --args '{"prompt":"hello"}' --json
```

The physical plugin id may still be `@refarm/pi-agent` in stored task metadata.
The no-token `refarm:agent:e2e:mock` gate exercises this alias through HTTP
task dispatch against the model mock and follows the returned status/log
handoffs. It also checks `task resume --json` before and after the effort
reaches `done`, so active continuations stay visible and terminal efforts do
not keep misleading resume commands. Finally, it calls the top-level
`resume --json` to ensure terminal task history remains inspectable without
reintroducing `task resume` as the next step.

### Runtime And Plugins

Purpose: keep the execution plane recoverable without manual guessing.

Rules:

- `runtime.sidecarUrl` is the persisted endpoint primitive for the selected
  runtime sidecar. `REFARM_SIDECAR_URL` may override it for one command, but
  external workspaces should prefer:

```bash
refarm config set runtime.sidecarUrl http://127.0.0.1:42001 --local --json
```

- `runtime status --json` must expose the resolved `sidecarUrl` and
  `sidecarUrlSource` so agents can tell whether they are probing the default,
  environment override, home config, or project-local config.
- `runtime status --json` should also expose `sidecarProbe` with the probe URL,
  readiness, HTTP status, timeout flag, or transport error. A failed runtime
  probe should not require the operator to run `curl` manually to learn the
  failure shape.
- When Tractor runs inside Docker/devcontainer, the HTTP sidecar must bind to
  the container interface (`0.0.0.0`) so the Docker-published `42001` reaches it
  from host workspaces. Local non-container startup remains loopback-only by
  default (`127.0.0.1`).
- `runtime ensure --wait --json` converges to `resume` when ready.
- If `runtime ensure --wait --json` starts a runtime but readiness does not
  converge and the startup log has no actionable output, the recovery handoff
  should point to `refarm runtime start --dry-run --json` before retrying
  `ensure`.
- `check --next-action --json` is the composite readiness gate.
- `check --json` should include the local model provider doctor as a warning
  signal. `check --next-action --json` remains blocking-only: `ok: true` means
  `nextCommands: []`. Before an agentic prompt, run `model doctor --json` when
  the selected route is a local provider.
- Plugin recovery should prefer the operator alias:

```bash
refarm plugin reload runtime-agent --json
```

- Plugin status may expose `@refarm/pi-agent` as installed/loaded identity
  because that is the manifest id.
- Reload outcomes must distinguish `reloaded`, `skipped`, and `deferred`.
- The no-token `refarm:agent:e2e:mock` gate exercises
  `plugin reload runtime-agent --json` against the isolated runtime and follows
  the returned `plugin status --json` handoff. A loaded plugin may report
  `skipped`; the contract is that the public alias normalizes to
  `@refarm/pi-agent` and status remains inspectable.

### Health Policy

Purpose: separate generic workspace health from Refarm-specific assumptions
before using the CLI in another repository.

Rules:

- `refarm health --policy --json` is the inspection primitive for the resolved
  health policy. It should not run the auditors.
- `refarm health --suggest-policy --json` is the dry-run calibration primitive.
  It may run auditors, but it must not write `refarm.config.json`.
- `refarm health --apply-suggested-policy --json` is the explicit write
  primitive. It should preserve unrelated `refarm.config.json` fields, replace
  only the `health` block, and then point back to
  `refarm health --next-action --json`.
- In the Refarm monorepo, the policy may carry Refarm-specific roots,
  exemptions, and generated-source exclusions.

### Complexity Pressure

Purpose: make large-file pressure visible before agents normalize working inside
files that are too large to reason about cheaply.

Rules:

- Ecosystem primitive: `@refarm.dev/health` owns reusable complexity scanning,
  and workspaces opt in through `health.complexity` in `refarm.config.json`.
  When enabled, `refarm health --json` reports blocking large files alongside
  git/build diagnostics, so `refarm check --json` can carry the same pain into
  an agentic daily-driver loop.
- Refarm monorepo wrapper: `pnpm run repo:complexity` is the local baseline
  audit for tracked files over the configured line budget.
- Refarm monorepo wrapper: `pnpm run repo:complexity:changed:strict` is the
  safe local gate for new slices. It blocks changed files that cross the line
  budget without requiring the existing backlog to be fixed first.
- Refarm monorepo wrapper: `pnpm run repo:complexity:strict` is diagnostic until
  the current backlog is split or explicitly classified. Do not add it to broad
  gates before the baseline is triaged.
- Refarm-specific allowances such as generated fixtures, lockfiles, `.project`
  state, and vendored artifacts belong in the repo wrapper. Source and
  hand-written tests should normally be blocking unless there is a documented
  extraction plan.
- The report includes `category` and `summaryByCategory` so agents can separate
  source, test, docs, scripts, fixtures, and project-state pressure before
  choosing whether to split from below (shared helper/package) or above
  (command/test decomposition).
- JSON output keeps the complete `findings` arrays for audit, but also exposes
  `topBlockingFindings`, `topFindings`, and `reportLimit` for compact agent
  handoffs. Use `--limit <n>` when the operator needs a short triage view
  instead of the full backlog.
- The repo-local `repo:complexity` scripts are CI/operator wrappers over the
  same `@refarm.dev/health` complexity auditor, not a second detector. Keep
  repo-specific allowances in the wrapper and reusable scanning behavior in the
  package.
- Outside Refarm, the default policy is generic `workspace`; consumer-specific
  generated docs, skill packages, non-TS package layouts, and complexity
  allowances belong in that repo's `refarm.config.json`.
- `refarm health --next-action --json` and
  `refarm check --next-action --json` should point to
  `refarm health --suggest-policy --json` when the next useful move is policy
  calibration rather than runtime repair.
- `refarm check --json` remains the full diagnostic report; the
  `--next-action --json` form should stay compact enough for an agent to follow
  without parsing hundreds of equivalent file-level findings.
- Do not expose `--apply-suggested-policy` as an automatic continuation from
  dry-run suggestion output; applying policy is a deliberate write.

### Model Routing

Purpose: let the agent know which model path it is about to use.

Rules:

- `model current --json` is the inspection primitive.
- `model doctor --json` is the live local-provider probe. Keep
  `model current` deterministic; use `model doctor` to check endpoints such as
  Ollama and emit recovery commands like `ollama serve` or a Docker-aware
  `model base-url` handoff when the runtime cannot reach the provider.
- `sow --model <provider/model>` changes the route.
- Credential collection may be interactive, but JSON recovery must name the
  command that resumes inspection after configuration.
- No-token validation should use the mock model path before live provider checks.

### Finish

Purpose: close a slice with enough verification signal for the changed surface.

Rules:

- After source edits:

```bash
refarm agent finish --lane after-edit --run --json
```

- After public JSON or CLI contract changes:

```bash
refarm agent finish --lane handoffs --run --json
```

- After runtime-agent, model routing, or ask execution changes:

```bash
refarm agent finish --lane agent-e2e-mock --run --json
```

- A passing finish returns `nextCommand: "refarm resume --json"`.
- When a source change modifies a workspace package API consumed through
  `dist/`, build that dependency before running direct consumer tests. Turbo
  and `refarm agent finish` encode this order; ad hoc commands such as
  `pnpm -C apps/refarm exec vitest ...` do not.
- Root scripts that call `scripts/ci/run-workspace-script.mjs` for
  `apps/refarm` tests or type-checks should use `--with-dependency-builds`.
  That wrapper runs `pnpm --filter <workspace>... run build` first, so package
  APIs consumed through `dist/` are synchronized before the consumer command.

## Hardening Order

Before the operator migrates fully to Refarm as the primary daily driver, prefer
work in this order:

1. Keep the self-guiding loop green: `resume -> inspect handoff -> check ->
   edit -> finish -> resume`.
2. Keep no-token execution with model-mock ahead of live-provider token checks.
3. Move repeated handoff/process/status contracts from `apps/refarm` into
   shared packages only after repeated use proves the boundary.
4. Exercise one non-Refarm task through the same primitives to prove Refarm is a
   daily-driver tool, not only a self-maintenance loop.
5. Keep `runtime-agent` as the operator concept and `@refarm/pi-agent` as the
   compatibility identity until a package rename is worth the migration cost.

## Cut Discipline

The no-token operator smoke is now the confidence gate for the self-driving CLI
loop. It covers runtime startup, plugin reload/status, `ask`, session handoff,
HTTP task dispatch, task status/log handoffs, `task resume`, top-level `resume`,
model-mock requests, and stream-file creation.

Do not keep expanding this smoke just because another self-reference is
possible. Add new assertions only when one of these is true:

- a real operator slice fails and the failure would have been caught by the
  smoke;
- a second consumer needs the same primitive and exposes a boundary gap;
- a public JSON handoff contract changes;
- runtime/model/task behavior changes under the existing daily-driver path.

Otherwise, the next maturity signal should come from using the same primitives
on a non-Refarm task. That is the proof that Refarm is becoming a daily-driver
tool instead of a system that only maintains itself.

## Non-Goals For The Bootstrap Phase

- Renaming the physical `packages/pi-agent` package or WASM artifact.
- Rewriting historical session/task data.
- Moving every helper out of `apps/refarm` before there is a second consumer.
- Treating live model calls as the first validation signal when mock coverage is
  available.
