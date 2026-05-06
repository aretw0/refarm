# Refarm Studio diagnostic screens

Status: local strategy baseline

## Decision

`apps/dev` diagnostic routes are not the public `refarm.dev` information architecture. They are Studio workbench slices used to prove host/runtime primitives before those primitives are promoted into daily-driver product surfaces.

Keep the split narrow:

| Route | Purpose | Should prove | Should not become |
| --- | --- | --- | --- |
| `/streams` | Temporal observability | `StreamSession`/`StreamChunk` storage, live stream statusbar/panel rendering, stream surface capability | A second dashboard, content feed, or general agent UX |
| `/surfaces` | Surface activation diagnostics | manifest-declared surfaces, slot/kind/capability gates, registry trust, render/action telemetry | A plugin marketplace, design gallery, or stream monitor |

If a page cannot state its distinct proof in one sentence, merge it into another diagnostic route or demote it to a test fixture.

## Product boundary

For future `refarm.dev` public UX, avoid exposing these routes as primary concepts. Public information architecture should talk about user outcomes and host modes. `Streams` and `Surfaces` are platform diagnostics vocabulary.

## Accessibility guardrail

DS workbench surfaces must be contrast-stable. Do not place `--refarm-text-secondary` over light or mixed backgrounds where contrast depends on the text's horizontal position. A deterministic contrast check in `packages/ds/src/contrast.test.ts` guards the dark workbench background contract.
