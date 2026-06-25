# Plan: Homestead Build-Free SSR Tier (Roadmap Item 4b)

> Spec: `specs/features/2026-06-25-homestead-ssr-tier.md`.
> Goal: expose `@refarm.dev/homestead/ssr` as pure string helpers for build-free server-rendered
> surfaces, then prove it by rebuilding `vault-seed`'s `dgk serve` admin.

## Prerequisite

Item 4a must provide the `ds` token contract and component classes. Do not start this plan while
`ds/components.css` is absent.

## Task 1 - SSR Helper Red Tests

- Add tests for `shellHtml`, `sectionHtml`, `gridHtml`, `cardHtml`, `tableHtml`, `fieldHtml`,
  `buttonHtml`, `feedbackHtml`, `footerHtml`, and `escapeHtml`.
- Assert escaping for interpolated content before implementing helpers.
- Gate: helper tests fail for missing implementation.

## Task 2 - Implement Pure String Helpers

- Implement `packages/homestead/src/ssr/index.ts` and any local helper modules.
- Emit semantic HTML with `ds-*` classes; no browser runtime, no custom elements, no DOM dependency.
- Gate: helper tests pass under plain Node.

## Task 3 - Subpath Export and Isolation

- Add `./ssr` to `packages/homestead/package.json` exports and build outputs.
- Add an import-graph or focused test that fails if `ssr` imports `./sdk` or browser runtime
  modules.
- Gate: package type-check/build and isolation test pass.

## Task 4 - A11y Assertions

- Reuse or mirror the `A11yGuard` label/role rules against the string output.
- Cover buttons, fields, tables, feedback, and document landmark structure.
- Gate: a11y test fails on missing labels/roles.

## Task 5 - `vault-seed` Consumer Proof

- Pack `homestead` and `ds` via `docs/DEV_CROSS_REPO_CONSUMPTION.md`.
- On `vault-seed`, rebuild `packages/cli/src/commands/serve.js` from `@refarm.dev/homestead/ssr`.
- Preserve `node:http`, routes, and vanilla fetch client.
- Gate: `dgk serve` renders and `docs/roteiro-teste-admin.md` passes.

## Task 6 - Acceptance Wiring

- Register `homestead/ssr` tests in `test-capabilities` and `gate-smoke-contracts`.
- Add a changeset.
- Final gate: `pnpm -C packages/homestead run lint && pnpm -C packages/homestead run type-check && pnpm -C packages/homestead run test`.
