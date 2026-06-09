# Refarm Operator Daily Driver

Status: maintained operator path for using Refarm on Refarm itself.

This guide is the short loop to follow when Refarm is the daily CLI driver. It
does not replace the deeper playbooks; it gives the operator and coding agents a
stable path for starting, resuming, changing, and closing work.

For the layer boundaries behind this loop, see
[`OPERATOR_PRIMITIVES.md`](OPERATOR_PRIMITIVES.md). The CLI is the cockpit;
shared contracts should move down only when repeated use proves the boundary.

## Start The Day

```bash
refarm resume --json
refarm status --json
refarm doctor --next-command
```

Use `refarm resume --json` first. It combines runtime readiness, recent sessions,
recent prompts, current model route, task checkpoints, and the last finish gate.
If it prints `nextCommands`, run the first command before guessing.

In the normal self-guiding path, the first resume often points at the active
timeline and then returns to the operator view:

```bash
refarm resume --json
refarm tree show <session-prefix> --json
refarm resume --json
refarm task resume --json
```

When the runtime is not ready:

```bash
refarm runtime ensure --wait
refarm resume --json
```

When operating a non-Refarm workspace against an existing Refarm sidecar, make
the endpoint explicit in that workspace instead of relying on shell state:

```bash
refarm config set runtime.sidecarUrl http://127.0.0.1:42001 --local --json
refarm config get runtime.sidecarUrl --json
refarm runtime status --json
refarm check --next-action --json
```

Use `REFARM_SIDECAR_URL` only for one-shot overrides; persisted
`runtime.sidecarUrl` is the daily-driver primitive.

## Work Loop

For interactive agent work:

```bash
refarm
```

For one-shot agent work:

```bash
refarm ask "summarize the current task"
```

For one-shot agentic work in JSON mode (self-guiding):

```bash
refarm ask "do X" --json
# nextCommands includes: resume --json, sessions show, agent finish after-edit
```

For task-style worker execution:

```bash
refarm task resume --json
refarm task list --json
refarm task status <effort-id> --transport http --watch
refarm task logs <effort-id> --transport http
```

Prefer `task resume --json` over starting from `task list --json` when a task
checkpoint exists. Resume carries the current continuation, model inspection
command, and per-effort status/log handoffs; list is the broader inventory view.

Prefer commands that emit JSON when another agent or script will consume the
result. Public JSON commands expose `ok`, `nextCommand`, `nextCommands`, and
enough context to recover without hidden session knowledge.

When running in agentic JSON mode, commands are self-guiding:
- `ask --json` success → `nextCommands`: resume, session show, after-edit finish
- `agent finish --run --json` pass → `nextCommands`: resume
- `tree show <session> --json` done → `nextCommands`: resume
- `task resume --json` active/checkpoint → `nextCommands`: status/logs, resume
- `task status --json` done/failed → `nextCommands`: logs, resume
- `runtime ensure --wait --json` ready → `nextCommands`: resume
- `tidy imports --json` success → `nextCommands`: resume; `--check` success is terminal
- `sow --json` configured → `nextCommands`: check, model current

Runtime-agent operator aliases:

```bash
refarm task run runtime-agent respond --args '{"prompt":"hello"}' --json
refarm plugin reload runtime-agent --json
```

`runtime-agent` is the operator-facing alias. JSON payloads and plugin status may
still expose the physical bundled plugin id, `@refarm/pi-agent`, for compatibility
with installed plugin manifests and existing task history.

## Model And Credentials

Inspect the current route before changing it:

```bash
refarm model current --json
refarm model providers --json
```

Configure only what is needed:

```bash
refarm sow --model openai/gpt-5.5
refarm sow --github
refarm sow --cloudflare
```

For link-opening behavior in OAuth and browser handoffs:

```bash
refarm config get operator.openExternalLinks
refarm config set operator.openExternalLinks never
```

Use `never` for headless operator flows where printed URLs are preferred.

Provider selection, init template selection, GitHub owner input, migrate target
URL input, OAuth text prompts, and secret credential entry go through the shared
operator prompt contract.

## Session Recovery

Resume shows the active session and recent runtime sessions:

```bash
refarm resume --json
refarm sessions list --json
refarm sessions show <id-prefix>
refarm sessions use <id-prefix>
```

Use session prefixes only when they are unique. If a prefix is ambiguous, list
sessions first and use a longer prefix.

## Closing A Slice

Before committing source changes:

```bash
refarm agent finish --lane after-edit --run --json
```

After an atomic commit:

```bash
refarm agent finish --lane after-commit --run --json
refarm resume --no-status --json
```

This validates the most recent commit. Use `before-push` for the wider
branch-against-upstream gate.

Before pushing:

```bash
refarm agent finish --lane before-push --run --json
```

When the change touches JSON handoffs or public commands:

```bash
refarm agent finish --lane handoffs --run --json
```

When the change touches runtime/model routing, the runtime agent, or `ask` execution:

```bash
refarm agent finish --lane agent-e2e-mock --run --json
```

When import organization is the only mechanical cleanup left:

```bash
refarm agent finish --fix --run --json
```

## Where Changes Belong

- `apps/refarm`: final CLI UX, command orchestration, runtime HTTP calls, human
  output.
- `packages/cli`: reusable CLI contracts, JSON envelopes, command plans,
  handoff primitives, agnostic binary command builders, launch process specs,
  detached process launch, launch readiness policy, status schemas, Git command
  helpers, GitHub Actions CLI adapters, resume formatting.
- `packages/config`: provider, model, package-manager, and operator policy.
- `farmhand`, runtime, tractor: execution, state, worker/task lifecycle,
  sandboxing, logs, and recovery behavior.

When in doubt, keep the app thin but pragmatic: reusable contracts move down,
product-specific orchestration stays in `apps/refarm`.

The extraction rule is consumer-driven. `apps/refarm` can prove a workflow first,
but a primitive should move into `packages/*` when another independent consumer
needs it or when repeated Refarm flows depend on the same contract. External
consumers such as `agents-lab` and `vault-seed` should consume interfaces or
adapters, not import the Refarm engine directly into their core.

The app boundary is now guarded by `apps/refarm/test/architecture`: app source
does not import `node:child_process`, does not execute package managers directly,
and app commands use agnostic surface-action helper names. Keep compatibility
aliases in shared packages, not in app-local wrappers.

## Stop Condition

A slice is mature enough to commit when:

1. The source change is scoped and atomic.
2. Focused tests for the touched behavior pass.
3. Relevant `type-check`, `lint`, and `build` gates pass.
4. `refarm health` passes after significant refactors.
5. `refarm agent finish --lane after-commit --run --json` passes after commit.

Do not edit generated artifacts to satisfy these checks. Fix the source model and
rebuild.
