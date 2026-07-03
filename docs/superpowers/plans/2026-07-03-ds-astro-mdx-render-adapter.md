# `@refarm.dev/ds-astro` MDX render adapter — Plan

> Status: implemented locally and promoted to the active `vault-seed-ready`
> handoff candidate on 2026-07-03; downstream `vault-seed` validation remains
> the consumer-proven gate.

## Goal

Provide the product-neutral Astro/MDX binding that lets consumers author MDX with sanctioned DS
components instead of creating local block libraries. `@refarm.dev/content-projection` already owns the
MD/MDX-to-`records:v1` projection path; this slice owns the render-time component/import path.

## Trigger

The official `vault-seed` checkout now has a downstream proof plan:

- `docs/superpowers/plans/2026-07-03-ds-astro-mdx-consumer-proof.md`
- `docs/superpowers/specs/2026-07-03-mdx-block-migration-inventory.md`
- `scripts/mdx_content_surface_contract.test.mjs`

That consumer proof explicitly asks Refarm for a `ds-astro` embed set and forbids a local
`dgk-blocks`/`vault-blocks`/`astro-blocks` package. This closes the previous "wait for render pressure"
hold; implementation is still package-plan gated.

## Package boundary

Create a new publishable leaf:

- package: `@refarm.dev/ds-astro`
- depends on: `@refarm.dev/ds`
- peer depends on: `astro`
- does not depend on: `homestead`, `apps/site`, `vault-seed`, or private POC code

The package is a framework binding over `ds/html`; it must not move Astro into the core `ds` package.

## Minimum surface

First proof exports:

- `Card`
- `MetricStrip`
- `CalloutSection`
- `ContentList`
- `mdxComponents` or equivalent mapping for Astro MDX component resolution

Second-wave candidates, only after the first proof is boring:

- `GraphHero`, `TagCloud`
- `FacetPanel`, `RecordsList`, `InsightGrid`
- `NotebookCard`, `AvailabilityBadge`, `CardGrid`
- `GraphView`, `GraphToolbar`, `GraphLegend`

## Refarm acceptance

1. Add package metadata, README, exports, and tests following the existing package generator shape.
2. Implement thin Astro components that wrap or match `@refarm.dev/ds/html` output and inherit DS CSS.
3. Add an `apps/site` MDX fixture/page that renders one exported component.
4. Project that fixture through `@refarm.dev/content-projection` to a valid `records:v1` record.
5. Run focused package tests, `apps/site` build/smoke, and the release boundary audit.
6. Do not add the package to `vault-seed-ready` until the fixture and package checks are green.

## Downstream handoff

After the Refarm proof is green:

1. Pack `@refarm.dev/ds-astro` into the `vault-seed-ready` handoff candidate.
2. Add `consumerPull` metadata pointing at the official `vault-seed` proof plan.
3. Let `vault-seed` vendor the tarball and add `scripts/refarm_ds_astro_consumer_contract.test.mjs`.
4. Treat downstream success as the gate for marking the package consumer-proven.

Local proof recorded on 2026-07-03:

- `@refarm.dev/ds-astro` exports `Card`, `MetricStrip`, `CalloutSection`,
  `ContentList`, `dsAstroCssImports`, and `mdxComponents`.
- `apps/site/src/pages/ds-astro-proof.astro` renders the first component set.
- `apps/site/src/content/ds-astro-proof.mdx` exercises the MDX import surface
  and projects through `@refarm.dev/content-projection` as valid `records:v1`.
- Release policy now includes `@refarm.dev/ds-astro` in `vault-seed-ready` with
  `consumerPull.proofId = "ds-astro.mdx-render-adapter"`.

## Non-goals

- Full `apps/site` or `vault-seed` migration from Astro to MDX.
- A generic graph engine extraction.
- Product-vault labels, PARA semantics, route copy, notebooks, or `dgk` UX.
- A new content/source/acquisition contract.
- A DS composition guardrail; this package only needs to be compatible with that future lane.

## Ownership rule

If a block can be named with product-neutral props/slots and reused outside `vault-seed`, it belongs here
or in a later Refarm package. If it names PARA, `dgk`, notebooks, route copy, private providers, or
editorial vocabulary, it stays downstream.
