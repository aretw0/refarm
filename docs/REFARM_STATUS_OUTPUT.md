# Refarm Status Output

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
```

The JSON shape is the canonical contract. Human and Markdown output are views of
that contract.

`--markdown` includes YAML frontmatter with the same status envelope (host,
renderer, runtime, trust, plugin, stream counters) so static-site/reporting
pipelines can parse metadata without scraping body text.

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
    "surfaceActions": 0
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
  semantic Homestead telemetry, not DOM inspection.
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
- `streams:active-present`

Current builder behavior in `@refarm.dev/cli/status` emits these diagnostics
from contract state (not UI state):

- renderer capability posture (`renderer:*`)
- runtime readiness (`runtime:not-ready`)
- trust pressure counters (`trust:*`)
- plugin surface rejection counts (`plugins:*`)
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
