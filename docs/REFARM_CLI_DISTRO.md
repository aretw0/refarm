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
- `refarm doctor` (contract-based readiness gate with non-zero exit on failures,
  including host metadata in human/JSON report output)

`refarm web` now reuses the same status contract and can launch `apps/dev`
(`dev` or `preview`) after runtime preflight (`--launch`, optional `--dry-run`).
It can also request browser opening (`--open`, optional `--open-url`) while
keeping launcher failures explicit and non-fatal to preflight reporting.
Launch is fail-closed when status diagnostics include failure codes (for
example `runtime:not-ready` or `trust:critical-present`).
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
npm run refarm:host:smoke:ci
```

- `refarm:host:smoke` runs the focused `apps/refarm` command tests (`status`,
  `doctor`, `headless`, `web`, `tui`, and program wiring).
- `refarm:host:smoke:cli` executes low-cost CLI flow checks against built distro
  output (`refarm --version`, `refarm web --input`, `refarm tui --input`,
  `refarm status --json --input`, `refarm headless --input`,
  `refarm web --launch --dry-run --open`, `refarm tui --json`,
  `refarm doctor --json`, `refarm doctor` (summary), and
  `refarm tui --launch --dry-run`) and verifies invalid launcher values and
  invalid output/launch guard combinations (`--open`/`--dry-run` without
  `--launch`, `--json` + `--markdown`, `headless --markdown --summary`) are
  rejected fail-closed, using fixture-backed status input.
- `refarm:host:smoke:ci` runs the command suite + CLI flow smoke through CI
  wrappers under `scripts/ci/` and includes `apps/refarm` type-check by default.

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
- Homestead surface/action/telemetry helpers for semantic diagnostics;
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
