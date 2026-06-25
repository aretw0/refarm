# Plan: DS Token Contract (Roadmap Item 4a)

> Spec: `specs/features/2026-06-25-ds-token-contract.md`.
> Goal: make `@refarm.dev/ds` the semantic token contract that `vault-seed` can consume without
> keeping its own Lab token definitions.

## Task 1 - Contract and Conformance Red Tests

- Add failing tests for `REQUIRED_TOKENS`, `DS_TOKEN_CAPABILITY`, and
  `runDsThemeConformance` missing-token reporting.
- Keep the API small: `contract.ts`, `conformance.ts`, and re-exports from `index.ts`.
- Gate: `pnpm -C packages/ds run test` fails for the expected missing implementation.

## Task 2 - Theme CSS and Parser-Backed Conformance

- Add `tokens.css`, `tailwind-bridge.css`, and themes `tractor-green`, `oceano`, `terracota`,
  `verde-jardim`.
- Add a test helper that parses shipped theme CSS and verifies every required token exists.
- Gate: all shipped themes pass; an incomplete fixture fails with exact missing tokens.

## Task 3 - Scoped-Token Leak Test

- Add a fixture/test proving `[data-refarm-theme]` scopes tokens and host `:root` stays untouched.
- Do not emit raw global semantic tokens outside `@layer refarm.tokens` / scoped selectors.
- Gate: scope-leak test fails if semantic variables are placed directly on `:root`.

## Task 4 - Component Utility Classes

- Add `components.css` with the headless classes needed by item 4b: `ds-card`, `ds-btn`,
  `ds-field`, `ds-table`, `ds-section`, `ds-feedback`.
- Style only through semantic tokens; no hardcoded palette in component rules except fallback-safe
  transparent values.
- Gate: focused CSS test or snapshot asserts class names and token references.

## Task 5 - Acceptance Wiring and Consumer Proof Packet

- Register the new `ds` conformance test in `test-capabilities` and `gate-smoke-contracts`.
- Add a changeset.
- Pack the package and record the `vault-seed` consumer proof steps from
  `docs/DEV_CROSS_REPO_CONSUMPTION.md`; the consumer branch can remain separate.
- Final gate: `pnpm -C packages/ds run lint && pnpm -C packages/ds run type-check && pnpm -C packages/ds run test`.
