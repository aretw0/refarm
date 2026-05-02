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
- `refarm tui` (tui renderer preflight contract surface)
- `refarm doctor` (contract-based readiness gate with non-zero exit on failures)

`refarm web` now reuses the same status contract and can launch `apps/dev`
(`dev` or `preview`) after runtime preflight (`--launch`, optional `--dry-run`).
`refarm tui` currently validates TUI renderer posture; full TUI launcher/runtime
integration remains deferred.

Keep launcher orchestration thin and avoid splitting runtime policy away from
shared status/renderer contracts.

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
