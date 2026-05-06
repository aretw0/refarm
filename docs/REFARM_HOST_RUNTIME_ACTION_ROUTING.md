# Refarm host runtime and action routing boundary

Status: local planning baseline  
Related: [ADR-056](../specs/ADRs/ADR-056-unified-refarm-host-boundary.md), [Refarm Host Model](./REFARM_HOST_MODEL.md), [Renderer Contract v1](../specs/features/refarm-renderer-contract-v1.md), [Action readiness cookbook](./REFARM_ACTION_READINESS_COOKBOOK.md)

## Purpose

Define where runtime boot, host context, surface actions, telemetry, and status summarization belong as Refarm converges on one logical `refarm` host with Web, TUI, and headless renderers.

The goal is to prevent two failure modes:

1. app renderers re-owning plugin/runtime policy; and
2. reusable packages absorbing product-specific actions too early.

## Current evidence

### `apps/refarm` distro host spine

`apps/refarm` currently owns product command UX and renderer selection:

- `refarm status --renderer web|tui|headless`
- `refarm actions`
- `refarm web`
- `refarm tui`
- `refarm headless`
- `refarm doctor`

It boots enough Tractor state to produce the stable status contract and forwards renderer descriptors from `apps/refarm/src/renderers.ts` into `@refarm.dev/cli/status`.

### Homestead browser runtime

`@refarm.dev/homestead/sdk/runtime` owns the reusable browser runtime boot helper for Homestead consumers:

- OPFS SQLite opening;
- Loro storage/sync wiring;
- browser identity fixture;
- `Tractor.boot(...)` integration.

`apps/dev` and `apps/me` compose this helper but keep their product choices local: database names, namespaces, identity IDs, profiles, plugins, and action behavior.

### Surface context and actions

Homestead owns the generic surface action protocol:

- `HomesteadSurfaceRenderContextProvider`
- `HomesteadSurfaceRenderActionHandler`
- scoped context/action composition helpers
- shell telemetry for `ui:surface_action_requested` and `ui:surface_action_failed`

Product apps own action meaning:

- `apps/dev` uses diagnostics-only actions such as `studio:diagnostic-denied`.
- `apps/me` uses product-facing actions such as `me:vault-open`.

`apps/me` also proves the product-owned handler side of the shared envelope:
`resolveRefarmMePersonalSurfaceActionRequest(...)` and
`invokeRefarmMePersonalSurfaceAction(...)` construct and invoke the Homestead
action request while keeping personal-vault semantics inside the app.

The shell can detect and route a clicked surface action, but it must not decide what the action means.

### Status and diagnostics

`@refarm.dev/cli/status` owns the stable headless status envelope. It summarizes surfaces/actions from semantic state/telemetry rather than inspecting DOM. For `schemaVersion: 1`, `plugins.surfaceActions` prefers currently available surface action affordances when a host snapshot provides them, then falls back to historical action telemetry for older producers. Producers may also include optional `plugins.availableActions` entries with stable `id`, `label`, and `intent` fields so TUI/headless renderers can list/select affordances without DOM inspection.

`packages/runtime` and `packages/trust` currently expose small adapter summaries from Tractor-like objects. These are intentionally narrow and should remain stable seams for richer host state later.

## Ownership rules

| Concern                                        | Owner                                | Rationale                                                |
| ---------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Product command names, defaults, profiles      | `apps/refarm`                        | Product UX is not a neutral package primitive.           |
| Renderer descriptor vocabulary and conformance | `packages/homestead`                 | Shared by Web/TUI/headless and distro catalogs.          |
| Stable status JSON/diagnostic vocabulary       | `packages/cli`                       | Headless contract must be renderer-independent.          |
| Browser runtime boot helper                    | `packages/homestead`                 | Shared by Web Homestead consumers.                       |
| Runtime/trust summaries                        | `packages/runtime`, `packages/trust` | Narrow reusable adapters over Tractor state.             |
| Surface context/action protocol                | `packages/homestead`                 | Modalities need one action envelope.                     |
| Product action semantics                       | `apps/*`                             | `me:vault-open` and Studio diagnostics are app-specific. |
| Plugin execution/trust mechanics               | Tractor/registry/trust packages      | Renderers must not re-own runtime policy.                |

## Routing model

```text
surface/plugin declares action affordance
  -> Homestead shell renders action marker
  -> user/renderer triggers action
  -> shell emits ui:surface_action_requested
  -> host/app action handler decides product meaning
  -> handler performs or rejects action
  -> shell emits ui:surface_action_failed on handler failure
  -> status/inspectors summarize semantic telemetry
```

This model supports Web today and should also support TUI/headless later:

- Web clicks a DOM element with `data-refarm-surface-action-id`.
- TUI can select an action row/keybinding and emit the same action request.
- Headless can invoke an action by ID against a status/surface snapshot.

`@refarm.dev/homestead/sdk/surface-renderer` owns the shared action request helpers:

- `createHomesteadSurfaceRenderActionRequest(...)` resolves a host action ID into the renderer-independent request envelope.
- `invokeHomesteadSurfaceRenderAction(...)` invokes a product handler through that same envelope and returns whether it was handled.

The action envelope is shared; the interaction modality is not.

`apps/refarm/src/commands/headless-action.ts` is the first local headless
consumer of that envelope. It turns a status payload with
`plugins.availableActions` into a deterministic Homestead render request and
host context, exposes a typed dry-run envelope helper, then delegates selected
action IDs through `invokeHomesteadSurfaceRenderAction(...)`.
`refarm headless --action-request <id-or-index>` uses the shared app-level
action affordance selector and exposes the non-destructive half of that path by
emitting the deterministic action request envelope without executing product
behavior.

`apps/refarm/src/commands/status-surfaces.ts` owns the CLI distro's live host
status affordances. It converts product-owned `apps/refarm` actions such as
`open-status-report` and `inspect-trust` into a Homestead surface-state snapshot
so `refarm status` can expose `plugins.availableActions` without relying on DOM
inspection or fixture-only payloads. `apps/refarm/src/commands/status-actions.ts`
keeps the matching product-owned handler seam and invokes those live status
actions through the same shared Homestead action request envelope.
`refarm status --action <id-or-index>` is the explicit CLI execution seam for
those live status actions: it resolves the selection from
`plugins.availableActions`, creates the Homestead request from the live status
surface, invokes the app-owned handler, and prints a deterministic JSON envelope
with `handled` status. Web/TUI/headless readiness commands remain
non-destructive dry-runs.

`apps/refarm/src/commands/action-affordances.ts` owns the app-level action
affordance vocabulary shared by renderer-neutral host, Web, headless, and TUI
readiness paths: stable available action extraction, one-based rows, ID/index
selection, selection metadata, dry-run envelope construction, selected-row
formatting, and ID-list formatting.
`apps/refarm/src/commands/actions.ts` exposes `refarm actions` as the canonical
non-executing host action discovery command for operators and agents that do not
need a renderer-specific presentation. `apps/refarm/src/commands/web-actions.ts`
and `apps/refarm/src/commands/tui-actions.ts` keep renderer-specific headings/UX
wrappers. `refarm actions`, `refarm web --actions`, and `refarm tui --actions`
emit those rows, and `--select <id-or-index>` resolves one row using the same
selection vocabulary, without launching or executing product behavior. Adding
`--json` to those readiness forms emits deterministic dry-run envelopes for
agents while preserving the human row output as the default.

These paths keep action invocation and selection testable without giving
headless/TUI hosts product-specific action meaning.

## Promotion threshold

Do **not** promote a new runtime/action abstraction to `packages/*` after a single consumer.

Promote only when at least two independent consumers need the same mechanic **and** the mechanic is not product policy. Current examples:

- promoted: renderer descriptor/conformance vocabulary;
- promoted: generic surface context/action protocol;
- not promoted: `apps/me` personal vault action;
- not promoted: `apps/dev` diagnostics ledger UX;
- not promoted yet: app runtime boot boundary shape, until another product repeats it.

## Next local slices

1. Keep `apps/refarm` status/preflight as the canonical renderer-independent host signal.
2. Add richer host status inputs only through package summaries, not DOM/runtime globals.
3. Add richer product-owned action handlers only when the owning app has a clear confirmation/safety model; keep dry-run envelope output available for agents and tests.
4. Keep CI smoke wiring deferred while GitHub Actions budget is over allocation; validate locally with focused package/app tests.
5. Revisit the shell layout/footer scroll TODO before expanding Web renderer UX, because stable viewport ownership affects action surfaces, streams, and statusbars.

## Local validation references

Recent local-only validation for this boundary:

```bash
npm --prefix packages/homestead run test -- host-renderer --pool=threads
npm --prefix packages/homestead run type-check
npm --prefix packages/homestead run build
npm --prefix apps/refarm run test -- test/commands/status.test.ts test/commands/renderers.test.ts --pool=threads
npm --prefix apps/refarm run type-check
npm run refarm:host:smoke:dist-actions
npm --prefix apps/me run test -- me-surfaces me-renderers --pool=threads
npm --prefix apps/me run test -- me-runtime --pool=threads
npm --prefix apps/me run type-check
```
