# Refarm second consumer validation

Status: local validation complete
Consumer: `apps/me`  
Baseline: `apps/dev` Studio dashboard and surface diagnostics

## Purpose

Validate that promoted Homestead/design-system primitives are not only Studio-specific. The second consumer is `apps/me`, a product-facing personal sovereign space. The goal is to prove that app-owned UX can reuse the shared host shell while keeping product behavior outside `packages/*` until a repeated pattern is stable.

## What was integrated

`apps/me` now exercises the minimal shared path:

- **Layout**: continues to render through `@refarm.dev/homestead/ui` `Layout`.
- **Renderer catalog**: advertises `refarm-me-web` through the shared host renderer descriptor.
- **Surface**: registers an app-owned internal Homestead surface plugin, `refarm-me-personal-surface`, mounted into the shared `main` slot.
- **Host context**: provides app-owned context via `createRefarmMeSurfaceContextProvider()`.
- **Action**: exposes `open-personal-vault` and handles it through `createRefarmMeSurfaceActionHandler()` by emitting app-scoped telemetry.
- **Runtime boundary**: moves the Astro page boot into `apps/me/src/lib/me-runtime.ts` so the page remains a thin product boundary and the runtime is unit-testable.

## Files

- `apps/me/src/lib/me-runtime.ts`
- `apps/me/src/lib/me-runtime.test.ts`
- `apps/me/src/lib/me-surfaces.ts`
- `apps/me/src/lib/me-surfaces.test.ts`
- `apps/me/src/pages/index.astro`

## Findings

1. Homestead's `Layout` and slot discovery are reusable by a product app without extracting a new package.
2. The existing surface contract is sufficient for a second consumer to mount product-owned UI into shared slots.
3. App-owned context/action helpers are the right seam for now; extracting them globally would be premature.
4. `apps/dev` remains the richer diagnostics consumer, while `apps/me` validates product UX consumption.

## Atomic gaps before broader extraction

- Define a small shared convention for app runtime boot boundaries once a third consumer repeats the same shape.
- Add a host/browser URL-opening primitive for auth flows before provider login UX expands.
- Keep surface diagnostics in `apps/dev`; only promote diagnostics primitives if `apps/me` or another app needs the same ledger/inspector behavior.
- Consider a product-safe fallback for `renderRefarmMeBootFailure()` if persistent storage or browser sync fails.

## Local validation commands

Use focused local checks while GitHub Actions is over allocation:

```bash
npm --prefix apps/me run test -- me-surfaces me-renderers --pool=threads
npm --prefix apps/me run test -- me-runtime --pool=threads
npm --prefix apps/me run type-check
```

Note: on the current low-disk devcontainer, the combined Vitest invocation can time out while starting the jsdom worker. The split commands above passed locally and preserve the same test coverage with lower worker-start pressure.
