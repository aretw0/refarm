# Refarm Status Output

Related: [Action readiness cookbook](./REFARM_ACTION_READINESS_COOKBOOK.md)

`refarm status` is the first stable headless contract for the `apps/refarm`
CLI distro. It summarizes the host without requiring a Web DOM or TUI renderer.

## Output modes

The command supports:

```text
refarm status                         # human-readable summary
refarm status --json                  # stable machine-readable JSON
refarm status --markdown              # artifact-friendly report
refarm status --renderer web --json   # same contract in Web renderer mode
refarm status --renderer tui --json   # same contract in TUI renderer mode
refarm status --input status.json --json  # validate/render an existing status artifact
cat status.json | refarm status --input - --markdown  # read artifact from stdin
refarm headless --input status.json --action-request open-node  # dry-run action envelope by ID
refarm headless --input status.json --action-request 1          # dry-run action envelope by row index
refarm web --input status.json --actions              # selectable action rows for Web readiness
refarm web --input status.json --actions --select 1 --json  # selected Web action JSON dry-run
refarm tui --input status.json --actions              # selectable action rows for TUI readiness
refarm tui --input status.json --actions --select 1   # selected TUI action dry-run
```

The JSON shape is the canonical contract. Human and Markdown output are views of
that contract. When `plugins.availableActions` is present, summary and Markdown
views list the available action `id`, `label`, and optional `intent` so operators
can discover affordances without inspecting Web DOM.

`--markdown` includes YAML frontmatter with the same status envelope (host,
renderer, runtime, trust, plugin, stream counters) so static-site/reporting
pipelines can parse metadata without scraping body text. The Markdown body also
contains an `Available Actions` section, rendered as `- none` when no action
affordances are available.

## Canonical JSON shape

```json
{
  "schemaVersion": 1,
  "host": {
    "app": "apps/refarm",
    "command": "refarm",
    "profile": "dev",
    "mode": "headless"
  },
  "renderer": {
    "id": "refarm-headless",
    "kind": "headless",
    "capabilities": ["surfaces", "telemetry", "diagnostics"]
  },
  "runtime": {
    "ready": true,
    "databaseName": "refarm-main",
    "namespace": "studio-main"
  },
  "plugins": {
    "installed": 0,
    "active": 0,
    "rejectedSurfaces": 0,
    "surfaceActions": 1,
    "availableActions": [
      {
        "id": "open-node",
        "label": "Open node",
        "intent": "node:open"
      }
    ]
  },
  "trust": {
    "profile": "dev",
    "warnings": 0,
    "critical": 0
  },
  "streams": {
    "active": 0,
    "terminal": 0
  },
  "diagnostics": []
}
```

## Field rules

- `schemaVersion` must increment on breaking shape changes.
- `host.app` is product-owned and should be `apps/refarm` for the CLI distro.
- `renderer` should be derived from
  `@refarm.dev/homestead/sdk/host-renderer` descriptors.
- `runtime.ready` means the host could initialize enough runtime state to report
  trust/plugin/renderer status.
- `plugins.rejectedSurfaces` and `plugins.surfaceActions` should be derived from
  semantic Homestead state/telemetry, not DOM inspection. `surfaceActions`
  prefers currently available affordances and falls back to historical action
  telemetry for older producers.
- `plugins.availableActions` is optional and should only expose stable action
  affordance metadata (`id`, `label`, optional `intent`), not product-private
  payloads or DOM selectors.
- `trust` should summarize active policy/profile and warning/critical counts.
- `streams` should summarize stream observation state when available.
- `diagnostics` should use stable string codes before adding rich objects.

## Initial diagnostics vocabulary

Use stable string codes first:

- `renderer:non-interactive`
- `renderer:no-rich-html`
- `renderer:missing:<capability>`
- `runtime:not-ready`
- `trust:warnings-present`
- `trust:critical-present`
- `plugins:rejected-surfaces-present`
- `plugins:surface-actions-available`
- `streams:active-present`

Current builder behavior in `@refarm.dev/cli/status` emits these diagnostics
from contract state (not UI state):

- renderer capability posture (`renderer:*`)
- runtime readiness (`runtime:not-ready`)
- trust pressure counters (`trust:*`)
- plugin surface rejection and available action counts (`plugins:*`)
- stream activity (`streams:*`)

Richer diagnostic objects can be added later as `diagnosticDetails` without
breaking consumers of the string list.

## Implementation guidance

The first implementation should compose existing proofs:

- app-owned renderer descriptors from the future `apps/refarm` distro;
- headless snapshot patterns proven in `apps/dev/src/lib/studio-headless-runtime.ts`;
- Homestead surface inspector helpers for rejected surfaces and actions;
- Tractor/registry/trust summaries when available.

Do not make `refarm status` depend on Astro, browser DOM, or a TUI package.

Human-readable action discovery format:

```text
Available actions:
  - open-node: Open node (node:open)
```

Markdown action discovery format:

```md
## Available Actions
- open-node: Open node (node:open)
```

Headless action request dry-run:

```bash
refarm headless --input status.json --action-request open-node
refarm headless --input status.json --action-request 1
```

This command does not execute product behavior. It validates that the selected
ID or one-based row index resolves to an entry in `plugins.availableActions` and
emits the deterministic Homestead action request envelope that a future product
handler can consume. The JSON is produced by the app-owned headless dry-run
envelope helper and also includes additive `selection` metadata: `requested`,
`source` (`id` or `index`), `resolvedId`, and one-based `index`.

Web action row dry-run:

```bash
refarm web --input status.json --actions
refarm web --input status.json --actions --json
refarm web --input status.json --actions --select 1
refarm web --input status.json --actions --select 1 --json
```

This command does not launch the Web runtime or open a browser. It uses the same
shared ID/index selection vocabulary as TUI and emits `renderer: "web"` JSON
dry-run envelopes for agent-safe Web readiness checks.

TUI action row dry-run:

```bash
refarm tui --input status.json --actions
refarm tui --input status.json --actions --json
refarm tui --input status.json --actions --select 1
refarm tui --input status.json --actions --select 1 --json
```

A reusable local fixture is available at
`apps/refarm/test/fixtures/status-with-actions.json` for exercising both paths:

```bash
refarm headless --input apps/refarm/test/fixtures/status-with-actions.json --action-request open-node
refarm headless --input apps/refarm/test/fixtures/status-with-actions.json --action-request 1
refarm web --input apps/refarm/test/fixtures/status-with-actions.json --actions
refarm web --input apps/refarm/test/fixtures/status-with-actions.json --actions --json
refarm web --input apps/refarm/test/fixtures/status-with-actions.json --actions --select 2
refarm web --input apps/refarm/test/fixtures/status-with-actions.json --actions --select 2 --json
refarm tui --input apps/refarm/test/fixtures/status-with-actions.json --actions
refarm tui --input apps/refarm/test/fixtures/status-with-actions.json --actions --json
refarm tui --input apps/refarm/test/fixtures/status-with-actions.json --actions --select 2
refarm tui --input apps/refarm/test/fixtures/status-with-actions.json --actions --select 2 --json
```

This command does not launch the TUI runtime. It formats
`plugins.availableActions` as stable one-based rows such as
`[1] Open node — open-node (node:open)` so a future interactive TUI can use the
same selection vocabulary. `--actions --select <id-or-index>` resolves the same
vocabulary and prints the selected row, selection metadata (`requested`,
`resolved`, `source`), and the full available-action context without executing
product behavior. Adding `--json` emits a deterministic dry-run envelope with
`schemaVersion`, `statusSchemaVersion`, `renderer: "tui"`, optional `selection`,
optional `selectedAction`, and `actionRows` for agents that need structured
readiness output.

Code-level contract helpers live in `@refarm.dev/cli/status`:

- `REFARM_STATUS_SCHEMA_VERSION`
- `isRefarmStatusJson(payload)`
- `assertRefarmStatusJson(payload)`
- `formatRefarmStatusSummary(payload)` for deterministic human-readable host summaries
- `formatRefarmStatusJson(payload)` for deterministic JSON key ordering
- `getRefarmStatusSchemaVersionIssue(payload)` for version negotiation diagnostics
- `parseRefarmStatusJson(input)` for strict parsing with actionable schema errors
- `classifyRefarmStatusDiagnostics(payload, overrides?)` for consistent failure/warning/info splits

A golden snapshot fixture for schema v1 is maintained at
`packages/cli/src/__fixtures__/refarm-status-v1.golden.json`.
