# Plan: Dispatch Surface External API (Roadmap Item 4d)

> Spec: `specs/features/2026-06-25-dispatch-surface-external-api.md`.
> Goal: make the existing `@refarm.dev/dispatch-surface` package externally consumable without
> stabilizing accidental internals.

## Task 1 - Public API Lock Test

- Add a test that imports from `@refarm.dev/dispatch-surface` package root.
- Assert the supported export names from the spec.
- Gate: test fails if a public export is removed or renamed without updating the contract.

## Task 2 - Consumer-Style Fixture

- Add a focused validation or app test that imports only the package root.
- Exercise known/unknown channel resolution, route builders, and capability failure.
- Gate: no deep import from `src/dispatch-surface.ts`.

## Task 3 - README Contract Section

- Document the external consumer contract in `packages/dispatch-surface/README.md`.
- Include examples for parse, route build, and capability assert.
- Keep Rust-backed parity described as package-internal fallback.

## Task 4 - Gate and Acceptance

- Run `pnpm --filter @refarm.dev/dispatch-surface run test`.
- Run `pnpm --filter @refarm.dev/dispatch-surface run test:parity`.
- Run `pnpm --filter @refarm.dev/dispatch-surface run type-check`.
- Add a changeset if package docs/API tests are release-relevant.

## Non-Goal

Do not build `source-dispatch` here. This plan stabilizes the surface that item 7 will later use.
