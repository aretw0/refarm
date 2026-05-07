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

It is intentionally separate from Web/TUI/headless readiness commands so agents
can keep non-destructive discovery/dry-runs distinct from explicit execution.

## Canonical fixture

Use the local fixture when you need deterministic examples:

```bash
STATUS_FIXTURE=apps/refarm/test/fixtures/status-with-actions.json
```

It contains two fixture actions:

| Row | ID              | Label         | Intent          |
| --- | --------------- | ------------- | --------------- |
| 1   | `open-node`     | Open node     | `node:open`     |
| 2   | `inspect-trust` | Inspect trust | `trust:inspect` |

## Discovery paths

### Renderer-neutral host action readiness

```bash
refarm actions --input "$STATUS_FIXTURE"
refarm actions --input "$STATUS_FIXTURE" --select 2
refarm actions --input "$STATUS_FIXTURE" --select inspect-trust --json
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
- `readiness` from the app-local execution-plan readiness helper;
- `selection` metadata (`requested`, `source`, `resolvedId`, `index`);
- `actionRequest`, the renderer-independent Homestead request;
- `availableActions`, the status-derived affordance list.

## Selection rules

Selection is shared by `refarm actions`, Web, headless, and TUI readiness paths:

1. A stable action ID wins when it matches exactly.
2. A decimal integer resolves as a one-based row index.
3. Invalid selections fail closed and print the available action IDs.
4. `selection.source` records whether the request came from `id` or `index`.

This lets a human choose `[2]` while an agent can preserve the resolved stable
ID for later execution.

## Local validation slice

For action-readiness changes, prefer the aggregate local lane:

```bash
npm run refarm:actions:verify
```

For tighter iteration before the aggregate lane, use the underlying focused
checks:

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
stays dry-run, verify `refarm status --action --input` is rejected, and verify
`refarm status --action 2` returns a handled Homestead action invocation envelope.
Keep this as local validation; CI wiring remains deferred while GitHub Actions
budget is over allocation.

Run `npm --prefix apps/refarm run test:host-smoke -- --pool=threads` before a
larger checkpoint. Keep CI wiring deferred while GitHub Actions budget is over
allocation.

## Next implementation step

The next non-documentation slice should connect a richer product flow behind an
owning app handler only after the app has a clear confirmation/safety model.
Keep the handler in the owning app (`apps/dev`, `apps/me`, or `apps/refarm`),
consume the existing Homestead action request envelope, and retain the dry-run
commands for agent-safe verification.
