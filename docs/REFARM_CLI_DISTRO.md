# Refarm CLI Distro Plan

This plan describes the product-facing `refarm` command as an app/distro, not a
package block. It is the next product assembly over the host model defined in
[Refarm Host Model](./REFARM_HOST_MODEL.md). For restart context across short,
medium, and long horizons, see [Refarm Work Focus](./REFARM_WORK_FOCUS.md).

## Decision

Create the installable CLI/host as a future distro under `apps/` — `apps/refarm` — and keep reusable mechanics in `packages/`.

The CLI distro owns product choices:

- command names and help text;
- default mode and onboarding flow;
- profile selection and operational policy;
- release packaging and install story;
- how Web, headless, and future TUI renderers are selected.

Packages own reusable blocks:

- runtime boot helpers;
- Tractor/plugin/manifest/trust machinery;
- Homestead surface/action/telemetry contracts;
- renderer descriptor vocabulary;
- DS visual primitives;
- future TUI renderer primitives.

## First executable shape

The first useful `refarm` command should be small and boring:

```text
refarm web        # launch the local Web/Homestead experience
refarm headless   # print machine-readable runtime diagnostics/snapshots
refarm status     # summarize runtime, renderer, plugin, trust, and disk state
refarm doctor     # environment/preflight checks for local work
```

Do not start with a full agent loop. Start with the host boundary: can the
product command select a renderer, initialize the runtime, and report trustworthy
state using the same contracts as the apps?

## Implementation status (2026-05-02)

`apps/refarm` now ships the host-boundary command set:

- `refarm status` (human/json/markdown + artifact input validation)
- `refarm headless` (headless snapshot-first output surface)
- `refarm web` (web renderer preflight + launcher entrypoint via `--launch`)
- `refarm tui` (tui renderer preflight + terminal launcher entrypoint via `--launch`)
- `refarm open-url` (host-browser URL opener with devcontainer-aware fallbacks for auth/provider flows)
- `refarm actions` (renderer-neutral, non-executing host action readiness rows/JSON)
- `refarm tree` (read-only session/git timeline rows and dry-run fork/branch previews)
- `refarm doctor` (contract-based readiness gate with non-zero exit on failures,
  including host metadata in human/JSON report output)
- `refarm check` (cheap composite readiness gate over project health and host
  doctor diagnostics for local pre-push loops)
- `refarm health`, `refarm doctor`, and `refarm telemetry` now expose stable
  `recommendations` arrays in JSON output for agents and CI wrappers. Each
  recommendation uses at least `{ diagnostic, summary, action }`; commands may
  add `severity` or `target` when useful. `refarm health` also keeps `issueType`
  as a compatibility alias for its project-audit issue code.

`refarm web` now reuses the same status contract and can launch `apps/dev`
(`dev` or `preview`) after runtime preflight (`--launch`, optional `--dry-run`).
It can also request browser opening (`--open`, optional `--open-url`) while
keeping launcher failures explicit and non-fatal to preflight reporting.
Launch is fail-closed when status diagnostics include failure codes (for
example `runtime:not-ready` or `trust:critical-present`).
`refarm open-url <url>` is a small host-browser primitive for auth/provider
flows that need to open a URL from devcontainers, WSL, Linux desktops, macOS, or
Windows. The reusable opener lives in `@refarm.dev/cli/browser-open` and tries explicit `REFARM_BROWSER_OPEN_COMMAND`, VS Code `code --open-url`,
`wslview`, and common Linux openers before printing a manual fallback URL.

`refarm tui` reuses the same status contract and can launch terminal runtime
entrypoints (`watch` or `prompt`) after runtime preflight
(`--launch`, optional `--dry-run`). Launch is fail-closed when status
diagnostics include failure codes (for example `runtime:not-ready` or
`trust:critical-present`) and rejects invalid `--launcher` values.

`refarm web --launch` and `refarm tui --launch` now emit a shared Refarm
wordmark/banner (including version) before launch or dry-run output so both
host experiences carry consistent identity without affecting `--json`/
`--markdown` contracts. Version is resolved without importing `package.json`
as a module (`REFARM_VERSION` env first, then `npm_package_version`, then
package metadata read fallback) through shared `runtime-metadata` helpers so
other host commands can reuse the same resolution path (`refarm --version`,
launch banner, doctor metadata). Set `REFARM_BRAND_BANNER=0` to suppress
terminal banner output.

Keep launcher orchestration thin and avoid splitting runtime policy away from
shared status/renderer contracts.

### Host smoke command

For fast regression checks of the unified command spine:

```bash
npm run refarm:host:smoke
npm run refarm:host:smoke:cli
npm run refarm:host:smoke:quick
npm run refarm:host:smoke:dev
npm run refarm:host:smoke:ci
npm run refarm:host:smoke:auto:plan
npm run refarm:host:smoke:auto
npm run refarm:host:smoke:auto:test
npm run refarm:actions:verify
npm run refarm:tree:verify
```

- `refarm:host:smoke` runs the focused `apps/refarm` command tests (`status`,
  `doctor`, `headless`, `web`, `tui`, and program wiring).
- `refarm:host:smoke:cli` executes low-cost CLI flow checks against built distro
  output (`refarm --version`, `refarm web --input`, `refarm tui --input`,
  `refarm open-url --dry-run`, `refarm actions --input --select --json`,
  `refarm tree list --scope git --json`,
  `refarm tree preview --scope git --json`,
  isolated git `refarm tree fork --scope git --json`, fail-closed tree fork
  guards, `refarm status --json --input`,
  `refarm headless --input`,
  `refarm web --launch --dry-run --open`, `refarm tui --json`,
  `refarm doctor --json`, `refarm doctor` (summary), `refarm check --json`, and
  `refarm tui --launch --dry-run`) and verifies invalid launcher values,
  fail-closed doctor warnings (`doctor --fail-on-warnings`), and invalid
  output/launch/action guard combinations (`--open`/`--dry-run` without
  `--launch`, `--json` + `--markdown`, `headless --markdown --summary`, and
  `status --action --input`) are rejected fail-closed, using fixture-backed
  status input.
- `refarm:actions:headless:test`, `refarm:actions:renderers:test`,
  `refarm:actions:test`, `refarm:actions:type-check`, and
  `refarm:actions:smoke-dist` are the granular action-readiness lanes for fast
  iteration: headless action-request contracts, renderer-neutral/Web/TUI
  contracts, full semantic Vitest contracts, TypeScript contracts, and built CLI
  dist smoke respectively. `refarm:actions:verify` composes the full semantic,
  type, and dist lanes as the closeout lane, including
  renderer-neutral/Web/headless/TUI no-actions and missing-selection blocked
  readiness. Use the narrow granular lane while iterating and the composed lane
  before declaring action-readiness envelope or selection changes complete.
- `refarm:tree:test`, `refarm:tree:smoke`, `refarm:tree:type-check`,
  `refarm:tree:farmhand:test`, and `refarm:tree:smoke:cli` are the granular
  tree lanes for mocked contracts, in-process git smoke, TypeScript contracts,
  farmhand session routing, and built CLI behavior respectively.
  `refarm:tree:verify` composes those granular lanes as the tree-only closeout
  lane. Use the granular lane while iterating and the composed lane before
  declaring a `refarm tree` stabilization slice complete.
- `refarm:host:smoke:ci` runs smoke auto routing tests, the command suite, CLI
  flow smoke through CI wrappers under `scripts/ci/`, includes `apps/refarm`
  type-check by default, and runs the built dist action-readiness smoke so
  dry-run vs live execution guardrails are covered before/inside CI validation.
- `refarm:host:smoke:quick` is the cheapest local lane (`--quick`): runs only
  `refarm:host:smoke` (skips type-check and CLI flows) for rapid slice loops.
- `refarm:host:smoke:dev` skips type-check but keeps CLI flow smoke, which is a
  pragmatic pre-push lane once `apps/refarm` type-check already passed.
- `refarm:host:smoke:auto:test` runs the pure routing regression tests for the
  diff-based auto lane.
- `refarm:host:smoke:auto:profiles` prints the canonical explicit profile list
  for manual narrow-lane previews/execution.
- `refarm:host:smoke:auto:plan` inspects changed files and prints the
  recommended lane (`skip | actions | tree | check | quick | dev | ci`) without executing it. By default
  it considers `@{upstream}..HEAD` when the branch is ahead, plus local
  working-tree/staged/untracked deltas, while ignoring `.pi/todos/**`
  operational notes. Non-doc action-readiness deltas route to
  `npm run refarm:actions:verify`, composite check/health gate deltas route to
  `npm run refarm:check:verify`, and non-doc tree deltas route to
  `npm run refarm:tree:verify` instead of the broader host smoke lanes; pure
  docs-only deltas still skip smoke. Manual `--profile` overrides also accept
  granular lane names such as `actions-headless`, `actions-renderers`,
  `actions-test`, `actions-type`, `actions-dist`, `check`, `tree-test`, `tree-smoke`,
  `tree-type`, `tree-farmhand`, and `tree-dist` for one-command narrow loop
  previews/execution. Shared local helpers such as `execution-plan.ts` stay on
  the `dev` lane because they feed more than one host contract.
- `refarm:host:smoke:auto` runs the same diff-based selector and executes the
  recommended lane automatically.

### Recommended local cadence (to avoid re-running everything)

- **Default ergonomic path:** `npm run refarm:host:smoke:auto`
- **Preview decision only:** `npm run refarm:host:smoke:auto:plan`
- **Explicit pre-push range preview:**
  `node scripts/ci/smoke-refarm-host-auto.mjs --from origin/develop --to HEAD`
- **Explicit profile preview:**
  `node scripts/ci/smoke-refarm-host-auto.mjs --profile tree`
- **List explicit profiles:**
  `npm run refarm:host:smoke:auto:profiles`
- **List explicit profile mappings:**
  `npm run refarm:host:smoke:auto:profiles:json`
- **Explicit granular profile preview:**
  `node scripts/ci/smoke-refarm-host-auto.mjs --profile actions-headless`
- **Machine-readable profile preview:**
  `node scripts/ci/smoke-refarm-host-auto.mjs --profile actions-headless --json`
- **Manual override inner loop:** `npm run refarm:host:smoke:quick`
- **Manual override pre-push:** `npm run refarm:host:smoke:dev`
- **Manual override CI parity checkpoint:** `npm run refarm:host:smoke:ci`

This avoids duplicate local execution of the same test + CLI flows while
keeping one full parity pass before/at push.

## Renderer modes

| Mode       | Initial role              | Uses                                                           | Output                        |
| ---------- | ------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `web`      | Default human UI          | Homestead/DS, Astro-built app, Web renderer descriptor         | Browser/local server          |
| `headless` | Automation and CI         | Host renderer snapshots, semantic telemetry, trust diagnostics | JSON/Markdown/logs            |
| `tui`      | Future terminal workbench | Future TUI block plus same host contracts                      | Terminal panes/status/actions |

TUI should wait until the Web/headless contract has enough pressure. The current
proofs are intentionally Web + headless because they validate the split without
introducing a terminal renderer too early.

## Minimal package composition

A future CLI distro should compose, not own, these blocks:

- `@refarm.dev/homestead/sdk/host-renderer` for renderer descriptors;
- `@refarm.dev/homestead/sdk/runtime` for browser/Web runtime boot where
  applicable;
- Homestead surface/action/telemetry helpers for semantic diagnostics, following the ownership boundary in [Refarm Host Runtime and Action Routing](./REFARM_HOST_RUNTIME_ACTION_ROUTING.md);
- Tractor packages for plugin/runtime execution;
- plugin-manifest/registry/trust packages for install and activation policy;
- DS only through Web-facing distributions, not for headless output.

If product code starts duplicating reusable mechanics across apps, cultivate the
mechanic into `packages/`. If the code is command UX, copy, defaults, or release
policy, keep it in the CLI distro.

## First slices before scaffolding

1. Keep Web and headless renderer descriptors healthy in existing apps.
2. Define a stable JSON shape for headless snapshots.
3. Keep the `refarm status` output contract in [Refarm Status Output](./REFARM_STATUS_OUTPUT.md) stable before implementing it.
4. Use `apps/refarm` as the expected distro path unless a later product constraint forces a rename.
5. Scaffold only the smallest CLI that can print status from composed blocks.

## Non-goals for the first CLI

- No full agent replacement for Pi yet.
- No TUI package until there is real contract pressure.
- No plugin marketplace UX beyond reporting trust/install state.
- No moving product CLI code into `packages/`.
- No broad Rust or WASM rebuild lane unless the chosen slice requires it.
