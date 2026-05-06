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

These commands are dry-runs:

- they validate an action exists in `plugins.availableActions`;
- they resolve stable IDs or one-based row indexes;
- they emit deterministic human or JSON envelopes;
- they do **not** invoke product behavior;
- they do **not** decide app-specific action meaning.

Product semantics stay in `apps/*`. Generic action envelope mechanics stay in
Homestead. The shared app-owned selection vocabulary currently lives in
`apps/refarm/src/commands/action-affordances.ts` and should not move to
`packages/*` until a second independent consumer proves the need.

## Live status affordances

`apps/refarm` now publishes app-owned host status affordances from a local
Homestead surface-state snapshot. These commands work without an input fixture:

```bash
refarm status --json
refarm web --actions
refarm web --actions --select inspect-trust --json
refarm tui --actions
refarm headless --action-request inspect-trust
```

The live status affordances are intentionally small and product-owned by the CLI
distro: `open-status-report` and `inspect-trust`. They prove that renderer
action readiness can come from semantic host state instead of manually authored
fixtures. The matching app-owned handler seam lives in
`apps/refarm/src/commands/status-actions.ts` and consumes the same Homestead
action request envelope without moving CLI product semantics into `packages/*`.

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
shape as TUI with `renderer: "web"`.

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
- `selection` metadata (`requested`, `source`, `resolvedId`, `index`);
- `actionRequest`, the renderer-independent Homestead request;
- `availableActions`, the status-derived affordance list.

## Selection rules

Selection is shared by Web, headless, and TUI readiness paths:

1. A stable action ID wins when it matches exactly.
2. A decimal integer resolves as a one-based row index.
3. Invalid selections fail closed and print the available action IDs.
4. `selection.source` records whether the request came from `id` or `index`.

This lets a human choose `[2]` while an agent can preserve the resolved stable
ID for later execution.

## Local validation slice

For action-readiness changes, prefer focused local validation:

```bash
git diff --check -- \
  apps/refarm/src/commands/action-affordances.ts \
  apps/refarm/src/commands/headless.ts \
  apps/refarm/src/commands/headless-action.ts \
  apps/refarm/src/commands/web.ts \
  apps/refarm/src/commands/web-actions.ts \
  apps/refarm/src/commands/tui.ts \
  apps/refarm/src/commands/tui-actions.ts \
  apps/refarm/test/commands/action-affordances.test.ts \
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
  test/commands/web.test.ts \
  test/commands/web-actions.test.ts \
  test/commands/tui.test.ts \
  test/commands/tui-actions.test.ts \
  --pool=threads

npm --prefix apps/refarm run type-check
npm --prefix apps/refarm run build
```

Run `npm --prefix apps/refarm run test:host-smoke -- --pool=threads` before a
larger checkpoint. Keep CI wiring deferred while GitHub Actions budget is over
allocation.

## Next implementation step

The next non-documentation slice should add the first product-owned handler
behind this readiness path. Keep the handler in the owning app (`apps/dev` or
`apps/me`), consume the existing Homestead action request envelope, and retain
these dry-run commands for agent-safe verification.
