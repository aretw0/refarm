# Refarm action readiness cookbook

Status: local operator guide
Related: [Refarm Status Output](./REFARM_STATUS_OUTPUT.md), [Host runtime and action routing boundary](./REFARM_HOST_RUNTIME_ACTION_ROUTING.md), [Renderer Contract v1](../specs/features/refarm-renderer-contract-v1.md)

## Purpose

Action readiness is the non-destructive bridge between semantic host status and
future product-owned action handlers. It lets Web, TUI, and headless consumers
discover and select the same `plugins.availableActions` affordances without
scraping DOM, launching an interactive renderer, or executing product behavior.

Use this guide when validating action vocabulary locally, writing agent flows,
or preparing the first real app-owned handler.

## Safety model

Renderer readiness commands are dry-runs:

- they validate an action exists in `plugins.availableActions`;
- they resolve stable IDs or one-based row indexes;
- they emit deterministic human or JSON envelopes;
- JSON dry-run envelopes include a shared `readiness` line (`ready` or
  `blocked`) formatted by the app-local execution-plan helper;
- they do **not** invoke product behavior;
- they do **not** decide app-specific action meaning.

`refarm status --action <id-or-index>` is the explicit execution seam for the
current live status affordances. It still resolves through the same stable
ID/index vocabulary and Homestead action request envelope, but unlike Web/TUI
readiness rows or `headless --action-request`, it invokes the app-owned status
handler and reports whether the request was handled. Keep this path limited to
small, product-owned status actions unless a broader app flow has its own
confirmation UX.

Product semantics stay in `apps/*`. Generic action envelope mechanics stay in
Homestead. The shared app-owned selection vocabulary currently lives in
`apps/refarm/src/commands/action-affordances.ts` and should not move to
`packages/*` until a second independent consumer proves the need. Action
readiness JSON now reuses the app-local execution-plan readiness formatter from
`apps/refarm/src/commands/execution-plan.ts`, but that helper remains app-local;
package extraction still waits for an independent consumer outside `apps/refarm`.
When a selection is unavailable, guardrail errors list deterministic choices as
`[row] id` pairs so operators can retry by stable ID or row index.

## JSON continuation handoffs

Machine-readable Refarm command output should separate human guidance from
commands an operator agent can execute directly:

- `nextAction` / `nextActions` describe the next useful operator intent. They
  may include human language, REPL-only instructions, or manual steps. When an
  action is expressed as a command-like string, keep it concrete; put
  parameterized variants in explicit template catalogs instead.
- `nextCommand` / `nextCommands` contain shell-ready commands only. Do not put
  placeholders such as `<url>` or REPL commands such as `/reload` in these
  fields.
- `nextProcesses` contains structured process specs when the producer can
  describe the boundary without shell parsing. Each spec should include
  `command`, `args`, `display`, and optional `cwd` / `packageManager`. Agent
  runners should prefer this field when present and fall back to `nextCommands`.
- Command payloads that describe a lower-level process should expose a canonical
  `process` object with the same shape. Legacy fields such as `processCommand`
  and `processArgs` may remain during migration, but new consumers should read
  `process`.
- `templates` contain parameterized command templates for flows that are
  blocked until the operator supplies values. Each entry should include
  `command`, declared `parameters`, and `useWhen` guidance. Treat templates as
  input forms, not executable commands; every `<parameter>` in `command` or
  `process.args` must be listed in `parameters`.
- Templates that must run from another workspace should use `cwdParameter`
  instead of encoding `cd <dir> && ...` into `command`. The `command` remains
  the operator-facing/backcompat handoff; the cwd parameter tells a machine
  runner where to execute it after substitution. When a template also includes
  `process`, runners should substitute parameters in `process.args` and execute
  `process.command` directly from the substituted cwd.
- Shared template mechanics live in `@refarm.dev/cli/command-handoff`:
  `commandTemplateParameters` validates placeholder declarations and
  `instantiateProcessTemplate` turns a parameterized process template into a
  spawn-ready `command` + `args` spec without shell parsing.
- Public template catalogs that include placeholders should expose `process`
  whenever the producer knows the executable argv. Keep `command` for operator
  display and backwards compatibility.
- Machine runners can call `instantiateCommandTemplate` with a template and
  parameter map to get substituted `command`, optional `process`, and optional
  `cwd` without parsing shell text.
- Execution-plan handoffs may attach `process` to generated templates via
  `processTemplate`; machine runners should prefer that over parsing
  `template.command`.
- Prefer `refarm ...` commands for continuation when the CLI can express the
  action. Use lower-level commands such as `git ls-remote ...` or
  `gh secret list` only when they are the deterministic verification surface.
- Preserve package-manager agnosticism in command handoffs. If a command needs
  the workspace package manager, route it through the existing Refarm helper or
  local package-manager resolver instead of hardcoding `pnpm`, `npm`, or `yarn`
  in new logic.
- Successful dry-runs should usually point at the equivalent apply command.
  Successful apply flows should usually point at an observation command such as
  `refarm health --next-action --json`, a status/list command, or a provider
  verification command.
- Successful check-only flows may be terminal. Prefer empty `nextCommands` when
  the command already proved the requested condition and no recovery or follow-up
  observation is needed.

When adding or changing JSON output in `apps/refarm`, prefer the shared helpers
in `apps/refarm/src/commands/json-output.ts` and command construction helpers in
`apps/refarm/src/commands/command-handoff.ts`. Tests should assert both the
human-facing intent and the executable command when a flow is meant to be
agent-driven.

Run the contract test when touching public JSON handoffs:

```bash
refarm agent finish --lane handoffs --run --json
pnpm --filter @refarm.dev/refarm run test:handoffs
```

The finish lane is the operator-facing route; the package script is the focused
test target behind it. The contract statically rejects placeholders,
interactive credential collection, and REPL-only commands in executable handoff
fields. It also requires generated handoff arrays and declared template
parameters, and exercises generated handoffs from the action, core agent, model,
plugin, provision, renderer, package manager, tree, check, doctor, guide,
headless, health, init, resume, runtime, sessions, sow, task, telemetry, and
tidy commands.

Keep normalization centralized. `command-handoff.ts` owns trimming, empty-value
filtering, and deduplication for handoff lists. JSON emitters and command-result
readers should reuse that helper instead of open-coding their own list cleanup.

Command runners that consume Refarm JSON should parse through
`apps/refarm/src/commands/command-result.ts`. The parser accepts pure JSON first
and can recover a single JSON object from wrapper output when a subprocess emits
context before or after the machine-readable payload. Do not make downstream
agents scrape command-specific text.

## Agent finish handoffs

`refarm agent finish` is the CLI-owned end-of-slice handoff for coding agents.
It prints an ordered plan by default and only executes when `--run` is present:

```bash
refarm agent --next-command
refarm agent finish --json
refarm agent finish --templates --json
refarm agent finish --lanes --json
refarm agent finish --lanes --json --next-command
refarm agent finish --lane after-edit --run --json
refarm agent finish --lane before-push --run --json
refarm agent finish --lane handoffs --run --json
refarm agent finish --lane agent-e2e-mock --run --json
refarm agent finish --next-command
refarm agent finish --json --next-command
refarm agent finish --run --json
refarm agent finish --run --next-command
refarm agent finish --profile affected --run --json
refarm agent finish --profile affected --since upstream --run --json
refarm agent finish --profile affected --include-tests --run --json
```

The default plan is check-only: import organization check, health audit, then
the composite readiness gate. Use the explicit fix mode when an agent should
organize imports as the first finishing action:

```bash
refarm agent finish --fix --json
refarm agent finish --fix --next-command
refarm agent finish --fix --run --json
refarm agent finish --fix --run --next-command
```

Keep `--fix` opt-in. It may rewrite source files through `refarm tidy imports`,
while the default `finish --run` path should remain a verification-only signal.
If a finish run fails, `nextCommand` should forward the failing command's
recovery command, such as `refarm runtime start --wait`, instead of the whole
plan.

`refarm agent --json` exposes `verification.recommended` with lane commands so
agents do not need to infer the default finish path from the command catalog:

- `afterEdit`: dirty-tree validation after source edits;
- `afterCommit`: most-recent-commit validation after atomic commits;
- `beforePush`: final branch-local validation against upstream;
- `handoffs`: public JSON handoff contract validation;
- `agentE2eMock`: no-token runtime-agent/ask e2e smoke;
- `withPackageTests`: opt-in package tests when the slice requires them.

The same names can be passed to `refarm agent finish --lane <name>` as stable
shortcuts for those recommended commands; `verification.recommended` already
uses those lane shortcuts.

For renderers or agents that need labels, `verification.lanes` also lists the
same lane IDs with command, description, `useWhen`, and validation scope
metadata. Use `useWhen` for operator-facing choice prompts and
`validationScope` for automation policy.
`verification.finishLanesJsonCommand` points to
`refarm agent finish --lanes --json`, which exposes the same focused catalog
without requiring the full agent handoff.

Parameterized finish commands live under `verification.templates`. That is one
template surface in the broader JSON handoff contract: entries include the
command string, required `parameters`, and `useWhen` guidance. Treat them as
templates, not executable `nextCommands`; substitute the concrete workspace
directory or Git ref before execution.
`verification.finishTemplatesJsonCommand` points to
`refarm agent finish --templates --json`, which exposes only that template
catalog when an agent does not need the full handoff payload.

For code-editing slices, prefer `--profile affected` when Git status is the
source of truth. It keeps the default check-only finish gate and appends
package-level `type-check`, `lint`, and `build` scripts for changed workspaces
that have those scripts. Use `--profile package --workspace <dir>` when the
affected package is known explicitly or when validating a package without a Git
diff.

After committing an atomic slice, use the `after-commit` lane. It validates the
most recent commit (`HEAD~1..HEAD`) so docs-only and small commits stay cheap:

```bash
refarm agent finish --lane after-commit --run --json
```

For runtime, model routing, runtime-agent, or `ask` execution-plane changes, use the
explicit no-token e2e lane when you need the proof outside of `affected`
selection:

```bash
refarm agent finish --lane agent-e2e-mock --run --json
```

For final branch-local validation before push, add `--since <ref>` or use the
`before-push` lane. Use `--since upstream` when the current branch has an
upstream configured; it resolves locally and does not fetch from the network:

```bash
refarm agent finish --profile affected --since upstream --run --json
refarm agent finish --lane before-push --run --json
```

Keep package tests explicit. Add `--include-tests` when the slice needs package
test scripts in addition to the default `type-check`, `lint`, and `build`
scripts. This keeps the normal affected profile fast enough for frequent agent
handoffs while preserving a deterministic test path.

Each plan step declares an `effect`:

- `observe` reads current state and reports it;
- `verify` checks readiness without intentionally writing source;
- `write` may modify source or local state and must stay opt-in.

Plan and run envelopes also include top-level `effects` and `writes` fields so
automation can reject write-capable plans without scanning every step.

Plan and run envelopes include a `selection` block for deterministic routing:

```json
{
  "selection": {
    "profile": "affected",
    "fix": false,
    "includeTests": false,
    "lane": "after-edit",
    "since": null,
    "sinceRef": null,
    "validationScope": "dirtyTree",
    "workspace": null,
    "affectedWorkspaces": ["apps/refarm"]
  }
}
```

Use `selection.affectedWorkspaces` instead of scraping command strings when an
agent needs to explain or branch on the package set selected by Git status. Use
`selection.validationScope` to distinguish dirty-tree, branch-range, package,
contract, and quick validation without inferring from flags.

## Live status affordances

`apps/refarm` now publishes app-owned host status affordances from a local
Homestead surface-state snapshot. These commands work without an input fixture:

```bash
refarm status --json
refarm actions
refarm actions --select inspect-trust --json
refarm web --actions
refarm web --actions --select inspect-trust --json
refarm tui --actions
refarm headless --action-request inspect-trust
refarm status --action inspect-trust
```

The live status affordances are intentionally small and product-owned by the CLI
distro: `open-status-report` and `inspect-trust`. They prove that renderer
action readiness can come from semantic host state instead of manually authored
fixtures. The matching app-owned handler seam lives in
`apps/refarm/src/commands/status-actions.ts` and consumes the same Homestead
action request envelope without moving CLI product semantics into `packages/*`.

### Live status action invocation

```bash
refarm status --action inspect-trust
refarm status --action 2
```

This is the app-owned execution proof for the live status actions. The command:

- always resolves a live status payload and rejects `--input` artifacts;
- resolves the selected action using the shared ID/index selection rules;
- creates the Homestead action request from the live `apps/refarm` status
  surface;
- invokes the `apps/refarm` status action handler;
- prints a deterministic JSON envelope with `statusSource: "live"`,
  `selection`, `actionRequest`, `handled`, and `availableActions`.

The selection-to-result orchestration lives in
`apps/refarm/src/commands/status-actions.ts`; `status.ts` only performs command
guarding and output. Keep this app-owned seam as the action-result proof until a
second independent product needs the same execution envelope mechanics.

It is intentionally separate from Web/TUI/headless readiness commands so agents
can keep non-destructive discovery/dry-runs distinct from explicit execution.

## Canonical fixture

Use the local fixtures when you need deterministic examples:

```bash
STATUS_FIXTURE=apps/refarm/test/fixtures/status-with-actions.json
NO_ACTIONS_FIXTURE=apps/refarm/test/fixtures/status-no-actions.json
```

`status-with-actions.json` contains two fixture actions:

| Row | ID              | Label         | Intent          |
| --- | --------------- | ------------- | --------------- |
| 1   | `open-node`     | Open node     | `node:open`     |
| 2   | `inspect-trust` | Inspect trust | `trust:inspect` |

`status-no-actions.json` has no `plugins.availableActions`; use it to verify
blocked readiness envelopes such as `Blocked: no host actions available`.

## Discovery paths

### Renderer-neutral host action readiness

```bash
refarm actions --input "$STATUS_FIXTURE"
refarm actions --input "$STATUS_FIXTURE" --select 2
refarm actions --input "$STATUS_FIXTURE" --select inspect-trust --json
refarm actions --input "$NO_ACTIONS_FIXTURE" --json
```

Use this command when an operator or agent wants the canonical host action
vocabulary without choosing Web, TUI, or headless-specific presentation. It
resolves the same `plugins.availableActions` rows, never executes product
behavior, and emits JSON dry-run envelopes with `command: "actions"` plus the
status renderer kind used to resolve context.

### Human status views

```bash
refarm status --input "$STATUS_FIXTURE"
refarm status --input "$STATUS_FIXTURE" --markdown
```

Expected human summary section:

```text
Available actions:
  - open-node: Open node (node:open)
  - inspect-trust: Inspect trust (trust:inspect)
```

Expected Markdown section:

```md
## Available Actions
- open-node: Open node (node:open)
- inspect-trust: Inspect trust (trust:inspect)
```

### Web readiness rows

```bash
refarm web --input "$STATUS_FIXTURE" --actions
```

Expected shape:

```text
Available Web actions:
[1] Open node — open-node (node:open)
[2] Inspect trust — inspect-trust (trust:inspect)
```

This does not launch the Web runtime or open a browser.

### Web selected-row dry-run

```bash
refarm web --input "$STATUS_FIXTURE" --actions --select 2
refarm web --input "$STATUS_FIXTURE" --actions --select inspect-trust
```

Both forms resolve to the same selected action and print selection metadata plus
the full Web action row context.

### Web JSON readiness envelope

```bash
refarm web --input "$STATUS_FIXTURE" --actions --json
refarm web --input "$STATUS_FIXTURE" --actions --select 2 --json
```

Use this path for agents that need structured Web readiness output without
starting the browser renderer. The envelope contains the same row/selection
shape as TUI with `renderer: "web"` and a shared `readiness` line such as
`{ "status": "ready", "label": "Ready: yes" }` when host actions are
available.

### TUI readiness rows

```bash
refarm tui --input "$STATUS_FIXTURE" --actions
```

Expected shape:

```text
Available TUI actions:
[1] Open node — open-node (node:open)
[2] Inspect trust — inspect-trust (trust:inspect)
```

### TUI selected-row dry-run

```bash
refarm tui --input "$STATUS_FIXTURE" --actions --select 2
refarm tui --input "$STATUS_FIXTURE" --actions --select inspect-trust
```

Both forms resolve to the same selected action. The output includes selection
metadata (`requested`, `resolved`, `source`) plus the full action row context.

### TUI JSON readiness envelope

```bash
refarm tui --input "$STATUS_FIXTURE" --actions --json
refarm tui --input "$STATUS_FIXTURE" --actions --select 2 --json
```

Use this path for agents that need structured readiness output. The envelope
contains:

- `schemaVersion: 1`;
- `statusSchemaVersion` from the input status payload;
- `reason: "dry-run"`;
- `readiness` from the app-local execution-plan readiness helper;
- `renderer: "tui"`;
- optional `selection` and `selectedAction` when `--select` is provided;
- `actionRows` with stable one-based indexes.

### Headless action request envelope

```bash
refarm headless --input "$STATUS_FIXTURE" --action-request open-node
refarm headless --input "$STATUS_FIXTURE" --action-request 1
```

Use this path when a future product handler needs the Homestead action request
shape. The envelope contains:

- `schemaVersion: 1`;
- `statusSchemaVersion` from the input status payload;
- `reason: "dry-run"`;
- `renderer: "headless"`, matching the renderer contract vocabulary used by
  Web/TUI/headless readiness envelopes;
- `readiness` from the app-local execution-plan readiness helper;
- `selection` metadata (`requested`, `source`, `resolvedId`, `index`);
- `actionRequest`, the renderer-independent Homestead request;
- `availableActions`, the status-derived affordance list.

## Selection rules

Selection is shared by `refarm actions`, Web, headless, and TUI readiness paths:

1. A stable action ID wins when it matches exactly.
2. A decimal integer resolves as a one-based row index.
3. Invalid selections fail closed:
   - human output rejects with deterministic `[row] id` choices;
   - JSON readiness output for `refarm actions`, `refarm web --actions`,
     `refarm tui --actions`, and `refarm headless --action-request` emits a
     blocked dry-run envelope instead of executing or inventing fallback
     behavior.
4. `selection.source` records whether the request came from `id` or `index`.

This lets a human choose `[2]` while an agent can preserve the resolved stable
ID for later execution.

## Local validation slice

For action-readiness changes, keep the feedback loop as small as the question
being asked:

```bash
# Narrow headless action-request loop.
npm run refarm:actions:headless:test

# Narrow renderer-neutral/Web/TUI readiness loop.
npm run refarm:actions:renderers:test

# Full semantic contract loop: Vitest only, no TypeScript build, no dist smoke.
npm run refarm:actions:test

# Type contract loop: run after source/type-shape changes.
npm run refarm:actions:type-check

# Built CLI loop: run only when emitted dist/package behavior matters.
npm run refarm:actions:smoke-dist

# Discover built CLI smoke-only profiles and options.
# The JSON form includes executable command strings for fresh-build and skip-build automation.
node scripts/ci/smoke-refarm-host-cli-flows.mjs --help
npm run refarm:host:smoke:cli:profiles
npm run refarm:host:smoke:cli:profiles:json
npm run refarm:host:smoke:cli:test

# Narrow built CLI proof for both action seams after one build.
npm run refarm:host:smoke:cli:action-seams
npm run refarm:host:smoke:auto -- --profile action-seams

# If apps/refarm was already built in the current iteration, skip the rebuild explicitly.
npm run refarm:host:smoke:cli:action-seams:skip-build
node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams --skip-build

# Narrow built CLI proof for renderer-neutral action readiness only.
npm run refarm:host:smoke:cli:actions-readiness
npm run refarm:host:smoke:cli:actions-readiness:skip-build

# Narrow built CLI proof for only the live status action-result seam.
npm run refarm:host:smoke:cli:status-action
npm run refarm:host:smoke:cli:status-action:skip-build

# Closeout lane: test + type-check + built dist smoke.
npm run refarm:actions:verify
```

For tighter one-off iteration before the aggregate lane, use the underlying
focused checks directly:

```bash
git diff --check -- \
  apps/refarm/src/commands/action-affordances.ts \
  apps/refarm/src/commands/headless.ts \
  apps/refarm/src/commands/headless-action.ts \
  apps/refarm/src/commands/actions.ts \
  apps/refarm/src/commands/web.ts \
  apps/refarm/src/commands/web-actions.ts \
  apps/refarm/src/commands/tui.ts \
  apps/refarm/src/commands/tui-actions.ts \
  apps/refarm/test/commands/action-affordances.test.ts \
  apps/refarm/test/commands/actions.test.ts \
  apps/refarm/test/commands/action-fixture.test.ts \
  apps/refarm/test/commands/headless.test.ts \
  apps/refarm/test/commands/headless-action.test.ts \
  apps/refarm/test/commands/web.test.ts \
  apps/refarm/test/commands/web-actions.test.ts \
  apps/refarm/test/commands/tui.test.ts \
  apps/refarm/test/commands/tui-actions.test.ts

npm --prefix apps/refarm run test -- \
  test/commands/action-affordances.test.ts \
  test/commands/action-fixture.test.ts \
  test/commands/headless.test.ts \
  test/commands/headless-action.test.ts \
  test/commands/actions.test.ts \
  test/commands/web.test.ts \
  test/commands/web-actions.test.ts \
  test/commands/tui.test.ts \
  test/commands/tui-actions.test.ts \
  --pool=threads

npm --prefix apps/refarm run type-check
npm --prefix apps/refarm run build
```

When a change affects built CLI distribution behavior or package ESM resolution,
run the local dist wrapper after source-level validation:

```bash
npm --prefix apps/refarm run smoke:dist-actions
npm run refarm:host:smoke:dist-actions
```

Both wrappers build `apps/refarm`, run the emitted CLI, verify `refarm web --actions`,
verify `refarm actions --select 2 --json` returns a non-executing host dry-run
envelope, verify fixture-backed `refarm actions --input ... --select 2 --json`
stays dry-run, verify no-actions JSON readiness blocks consistently for
`refarm actions`, `refarm web --actions`, `refarm headless --action-request`,
and `refarm tui --actions`, verify missing-selection JSON readiness blocks
consistently for `refarm actions`, `refarm web --actions`,
`refarm headless --action-request`, and `refarm tui --actions`, verify
`refarm status --action --input` is rejected, and verify the live
`refarm status --action 2` path returns a handled Homestead action invocation
envelope. Keep this as local validation; CI wiring remains deferred while GitHub
Actions budget is over allocation.

Run `npm --prefix apps/refarm run test:host-smoke -- --pool=threads` before a
larger checkpoint. Keep CI wiring deferred while GitHub Actions budget is over
allocation.

## Next implementation step

The next non-documentation slice should connect a richer product flow behind an
owning app handler only after the app has a clear confirmation/safety model.
Keep the handler in the owning app (`apps/dev`, `apps/me`, or `apps/refarm`),
consume the existing Homestead action request envelope, and retain the dry-run
commands for agent-safe verification.

## Current hardening slice

The current high-ROI action-readiness work is internal boundary hardening, not
broader action execution. Preserve the dry-run/readiness-first contract while
making renderer action rows easier to evolve.

Preferred targets:

- keep action selection, missing-selection, and no-actions readiness centralized
  in `action-affordances.ts`;
- keep Web/TUI/renderer-neutral wrappers as stable product-facing APIs, but let
  them delegate shared dry-run envelope and row-output mechanics;
- keep headless Homestead action-request semantics explicit: ready/blocked
  helpers may share envelope construction, but action requests should remain
  visible at the headless boundary;
- keep `status --action` as the explicit app-owned execution seam.

Non-goals for this slice:

- no generic host-wide action executor;
- no movement of product semantics into `packages/*`;
- no TUI-specific runtime policy fork;
- no package extraction of `execution-plan.ts` until another independent
  consumer creates pressure.

Closeout rule: use granular lanes while iterating and run
`npm run refarm:actions:verify` before declaring the hardening slice complete.
