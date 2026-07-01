# Plan: ADR-069 npm Scope Documentation Sweep

> Spec: `specs/features/2026-06-25-npm-scope-doc-sweep.md`.
> Goal: remove stale `@aretw0` Refarm publish targets from docs without touching legitimate DGK
> product references.

## Task 1 - Inventory Hits

- Run `rg "@aretw0" docs packages specs apps .changeset`.
- Classify each hit as Refarm publish target, DGK product, historical context, or owner handle.
- Gate: inventory exists before editing.

## Task 2 - Mechanical Rewrites

- Rewrite Refarm contract/block package examples to `@refarm.dev/*`.
- Rewrite tag commands and npm verification commands for Refarm packages.
- Keep `@aretw0/dgk-*` unchanged.
- Gate: diff contains no blind replacement of DGK product references.

## Task 3 - Historical Context Updates

- Where convergence docs mention the inconsistency, point to ADR-069 rather than preserving stale
  instructions.
- Keep ADR-069's context section as historical explanation.

## Task 4 - Verification

- Run `rg "@aretw0"` and review remaining hits.
- Run `git diff --check`.
- Final gate: no Refarm publish target remains under `@aretw0`.
