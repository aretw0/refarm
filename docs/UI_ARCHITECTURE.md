# Refarm UI Architecture

Refarm should use Astro as the durable composition layer without accidentally
building a half-framework in ad-hoc TypeScript.

## Decision

Use an **Astro-first, runtime-controller-small** model:

```text
Astro pages/layouts
  -> stable document structure, routes, copy, slots, static composition

Homestead SDK
  -> runtime boot, shell orchestration, plugin/surface contracts, trust gates

Small client controllers or custom elements
  -> live telemetry, DOM observers, user events, runtime-only updates

Plugin surfaces
  -> trust-gated extension boundary, not an app framework substitute
```

This keeps Refarm close to Astro's strengths while preserving the sovereign
runtime properties that Astro cannot provide by itself after hydration. The
product-facing host/CLI direction is documented in
[Refarm Host Model](./REFARM_HOST_MODEL.md): the CLI product can live in `apps/`,
while reusable renderer/runtime blocks stay in `packages/`.

## Ownership rules

| Concern                                         | Owner                                  | Why                                                      |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Routes, layouts, document scaffolding           | Astro pages/layouts                    | Astro is already the app composition system.             |
| Static panels, cards, explainers, proof lists   | Astro + DS classes                     | Avoid manual DOM construction for stable UI.             |
| Visual tokens and framework-agnostic primitives | `@refarm.dev/ds`                       | Shared style language without framework lock-in.         |
| Runtime boot, OPFS/Tractor/Loro setup           | Homestead SDK                          | Shared across first-party apps.                          |
| Plugin surface activation, trust, telemetry     | Homestead SDK                          | Security and semantics must be reusable.                 |
| Host-specific actions and fixtures              | Apps                                   | Navigation, demos, and presenter choices are host-owned. |
| Live telemetry presenters                       | Small controllers/custom elements      | Runtime-only state, but bounded and testable.            |
| Plugin-rendered HTML                            | Trust-gated Homestead surface contract | Extension boundary; not Astro composition.               |

## Guardrails

1. **No accidental React.** Do not grow large stateful UI trees with repeated
   `createElement`, `innerHTML`, event wiring, and manual refresh loops.
2. **Astro owns stable structure.** If a region is mostly static or page-local,
   render it in `.astro` and pass only the live slot/container to TypeScript.
3. **Controllers stay small.** A client controller should manage one live region
   or one custom element. If it grows beyond roughly 100-150 lines of DOM
   construction, extract static structure back into Astro or a shared primitive.
4. **Prefer custom elements for live islands.** When a runtime presenter needs
   lifecycle (`connectedCallback`, subscription cleanup, attributes), define a
   small custom element instead of inventing a bespoke mount/remount protocol.
5. **Cultivate shared UI in DS.** When a visual pattern repeats across first-party
   apps or Homestead surfaces, promote the framework-agnostic tokens/classes to
   `@refarm.dev/ds` instead of copying app-local CSS.
6. **Homestead remains semantic.** SDK helpers interpret surfaces, actions, and
   telemetry. Apps decide how to present them.
7. **Generated artifacts remain derived.** Build outputs are observations; edit
   source-level Astro/TS/CSS only.

## Astro vs controller decision checklist

Use Astro when the UI:

- is known at build time or page-load time;
- is mostly copy, layout, navigation, cards, or tables;
- does not need to subscribe to Tractor telemetry after boot;
- can receive initial state as HTML/data attributes.

Use a controller/custom element when the UI:

- subscribes to telemetry or graph updates;
- reacts to plugin mount/rejection/action events;
- needs deterministic setup/teardown;
- attaches host-owned event behavior to a runtime slot.

Use a Homestead surface when the UI:

- is provided by a plugin;
- must be capability/trust gated before execution;
- needs host context/actions through `renderHomesteadSurface(request)`;
- should emit auditable mount/render/action telemetry.

## Promotion path

`apps/dev` is the proving ground, not the final owner. Once a pattern appears in
more than one first-party surface or becomes useful outside the workbench,
promote it deliberately:

- **Homestead package**: runtime contracts, shell boot helpers, plugin/surface
  orchestration, telemetry semantics, trust gates, and reusable live island
  controllers that understand Homestead concepts.
- **DS package**: framework-agnostic visual primitives, CSS tokens, layout/card/
  badge/table/workbench classes, and accessibility-focused styling contracts.
- **App packages**: host-specific fixtures, navigation behavior, copy, demo data,
  presenter choices, and product routes.

Do not promote app code wholesale. Split it by responsibility: semantic runtime
mechanics go to Homestead; repeated visual language goes to DS; host behavior
stays in the app. The first promotions from this lane are DS visual primitives
for Studio workbenches/loading/data tables and Homestead's
`defineHomesteadReactiveElement(...)` lifecycle helper.

## Current pressure points

These files are acceptable for now but should not become unbounded UI
frameworks:

- `apps/dev/src/lib/surface-ledger.ts` now has a custom-element boundary; keep
  pushing stable table/copy structure toward Astro instead of growing the
  renderer indefinitely.
- `apps/dev/src/lib/surface-inspector.ts` now has a custom-element boundary;
  keep its visual shell aligned with DS primitives.
- `apps/dev/src/lib/studio-dashboard-runtime.ts` extracted dashboard boot
  wiring; keep it focused on runtime/plugin setup, not presentation.
- `apps/dev/src/lib/surface-diagnostics-runtime.ts` extracted `/surfaces` boot
  controller; keep it focused on runtime wiring, not presentation.
- `packages/homestead/src/sdk/Shell.ts` runtime DOM writes and trusted surface
  rendering

Near-term refactors should move stable markup back to Astro and keep the
TypeScript layer responsible only for live data binding, subscriptions, and
host-owned action dispatch.

## Long-term target

A mature Studio page should read like this:

```astro
<Layout title="Surfaces — Refarm Studio">
  <SurfaceWorkbenchCopy />
  <refarm-surface-ledger data-refarm-surfaces-ledger-slot></refarm-surface-ledger>
</Layout>

<script>
  import { bootSurfaceDiagnostics } from "../lib/surface-diagnostics-runtime";
  bootSurfaceDiagnostics();
</script>
```

Astro remains the readable composition layer. Homestead remains the runtime and
extension contract. The client island remains small enough to test and replace.
