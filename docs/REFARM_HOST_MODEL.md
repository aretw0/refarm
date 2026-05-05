# Refarm Host Model

Refarm should converge on a single host experience without collapsing its
package boundaries. The product-facing `refarm` CLI can live in `apps/`, while
`packages/` continue to provide the reusable blocks that any distro can compose.

This model is formally accepted in
[`ADR-056`](../specs/ADRs/ADR-056-unified-refarm-host-boundary.md).

## Decision

Use a **distro-owned host, block-owned primitives** model:

```text
apps/refarm-cli or equivalent distro
  -> product UX, command names, defaults, profiles, copy, release packaging

packages/* blocks
  -> runtime primitives, plugin contracts, trust gates, renderer adapters,
     storage/sync/identity, telemetry vocabulary, design primitives

renderers
  -> TUI, Web, and headless views over the same host/runtime contracts
```

This keeps the CLI as a Refarm product rather than a philosophy-neutral block,
while still forcing the CLI to dogfood the same reusable packages as the Web app
and future TUI/headless modes.

## Why not put the CLI product in `packages/`?

`packages/` are blocks: reusable, narrow, and as philosophy-neutral as possible.
A CLI named `refarm` is not neutral. It chooses workflows, words, defaults,
profiles, onboarding paths, and operational policy. Those are product decisions,
so the executable distro belongs under `apps/`.

The packages may still expose CLI-ready libraries, for example:

- host/runtime orchestration helpers;
- plugin manifest and registry validation;
- surface/action/telemetry contracts;
- renderer adapter interfaces;
- storage, sync, identity, and trust primitives.

But the command UX that users install and run is an app/distro assembly.

## Host responsibilities

The host is the logical process that owns Refarm's runtime boundary. It should:

1. initialize identity, storage, sync, and Tractor runtime;
2. load plugin manifests and resolve registry/trust status;
3. apply capability and surface trust gates before execution;
4. route host-owned actions requested by surfaces;
5. expose streams, telemetry, diagnostics, and status consistently;
6. choose or launch a renderer: TUI, Web, or headless;
7. persist enough state for sessions, audit, and recovery.

The host may be physically split into helper processes. For example, a Web mode
can launch a local server and browser window. Architecturally, it remains one
host contract with a Web renderer attached.

## Renderer responsibilities

Renderers should be replaceable views over the same host/runtime contracts.
They should not reimplement plugin loading, trust policy, action semantics, or
storage setup.

| Renderer | Product role                        | Should own                                                       | Should not own                                  |
| -------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Web      | Rich local Homestead/Studio UI      | routes, layouts, Astro composition, browser-specific controllers | plugin trust decisions or host action semantics |
| TUI      | Terminal-first workbench/agent loop | keyboard UX, panes, status bars, terminal rendering              | separate plugin/runtime policy                  |
| Headless | Automation/agent/CI mode            | machine-readable commands, logs, exit codes                      | human UI composition                            |

All renderers should consume the same core vocabulary. Homestead exposes the first shared vocabulary slice through `@refarm.dev/homestead/sdk/host-renderer`:

- renderer kind: `web`, `tui`, or `headless`;
- renderer capabilities: surfaces, surface actions, host context, streams, telemetry, diagnostics, interactivity, and rich HTML;
- plugin descriptors and installed handles;
- trust/activation status;
- surfaces and slots;
- host context and action descriptors;
- streams and live node subscriptions;
- telemetry and semantic diagnostics.

## App and package ownership

| Concern                                                | Owner                                               | Notes                                                                 |
| ------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| `refarm` command UX, installable CLI product, defaults | `apps/` distro                                      | Opinionated product surface.                                          |
| Web routes/layout/composition                          | `apps/*` + Astro                                    | Product-specific shell and copy.                                      |
| Homestead shell/runtime contracts                      | `packages/homestead`                                | Shared Web/runtime semantics.                                         |
| Framework-agnostic visual primitives                   | `packages/ds`                                       | Tokens/classes used by apps and Homestead surfaces.                   |
| Plugin manifest/schema validation                      | `packages/plugin-manifest`                          | Block-level contract.                                                 |
| Runtime host/plugin machinery                          | `packages/tractor*` and related blocks              | Reusable engine pieces.                                               |
| Registry/trust helpers                                 | `packages/registry` and Homestead/Tractor contracts | Blocks provide mechanics; apps choose policy profiles.                |
| TUI renderer primitives                                | future package block                                | Reusable terminal rendering/adapters; product command remains in app. |

## Relationship to the current apps

Current apps remain useful proving grounds:

- `apps/dev` proves Studio/workbench behavior and incubates platform mechanics,
  including Web and headless renderer descriptors over the shared host contract;
- `apps/me` proves citizen-facing product flows and validates shared DS/Homestead
  primitives and Web renderer descriptors outside the workbench;
- a future `apps/refarm` or `apps/cli` can be the installable CLI distro.

The migration path is not to move all app code into packages. It is to cultivate
only stable primitives into packages, then keep the final product assembly in an
app.

## Analogy with Pi

Pi demonstrates the desirable product shape: one agent host can expose terminal
and Web experiences without making each UI a separate runtime. Refarm should
learn from that shape, but adapt it to Refarm's own model:

- Refarm is graph/plugin/surface-first, not only agent-first;
- plugins write intent and data through Tractor contracts;
- the host executes actions and enforces trust;
- renderers present the same runtime state in Web, TUI, or headless form.

The long-term target is that a user can run Refarm through the mode that fits the
moment, while the underlying plugins, surfaces, telemetry, and audit model remain
consistent.

## Current implementation snapshot (2026-05-02)

`apps/refarm` now provides a concrete host command spine over the shared status
contract:

- `refarm status` (human/json/markdown + input artifact validation);
- `refarm doctor` (readiness verdict from status diagnostics);
- `refarm headless` (headless renderer contract surface);
- `refarm web` (web preflight + launcher modes, with optional browser open);
- `refarm tui` (tui preflight surface + launcher entrypoint with fail-closed diagnostics).

This keeps renderer behavior attached to one runtime/status vocabulary while
allowing launcher integration to evolve per modality.

## Near-term path

See [Refarm CLI Distro](./REFARM_CLI_DISTRO.md) for the product-facing command path.

1. Keep promoting repeated visual language to `@refarm.dev/ds`.
2. Keep promoting semantic runtime mechanics to `@refarm.dev/homestead` and
   Tractor-related packages.
3. Use `apps/me` as a second consumer before extracting more from `apps/dev`.
4. Track renderer parity against the [refarm-renderer-contract-v1 spec](../specs/features/refarm-renderer-contract-v1.md), expanding `@refarm.dev/homestead/sdk/host-renderer` only when Web/TUI/headless consumers need concrete fields.
5. When ready, create a CLI distro under `apps/` that composes the blocks instead
   of becoming a block itself.
