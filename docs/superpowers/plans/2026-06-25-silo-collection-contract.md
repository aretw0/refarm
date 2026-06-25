# Plan: Silo Collection Contract (Roadmap Item 4c)

> Spec: `specs/features/2026-06-25-silo-collection-contract.md`.
> Goal: move the `CredentialProvider` collection contract into `@refarm.dev/silo` while keeping
> concrete provider UX in the app and secret namespaces separate.

## Task 1 - Contract Red Tests

- Add `packages/silo/src/collect.test.ts` with a fake provider and fake storage path.
- Assert `collectAndStore` records `id`, `namespace`, and `stored`.
- Assert two namespaces do not collide.
- Gate: tests fail before `collect.ts` exists.

## Task 2 - Implement Collect Surface

- Add `collect.ts` with `CollectContext`, `CredentialProvider`, `SiloCollectResult`, and
  `collectAndStore`.
- Export from `packages/silo/src/index.ts`.
- Document reserved namespaces: `model`, `runtime`, `channel`, `publishing`.
- Gate: silo collect tests pass.

## Task 3 - Dependency and Cycle Check

- Add the minimal dependency on `@refarm.dev/prompt-contract-v1` for `OperatorChannel`.
- Verify build order stays acyclic.
- Gate: `pnpm run task:build-order:check` passes.

## Task 4 - Re-Home App Credential Types

- Change `apps/refarm/src/credentials/types.ts` into a thin re-export from `@refarm.dev/silo`.
- Add `namespace` to github/cloudflare/model providers.
- Prefer a mechanical import re-home if many files move at once; otherwise keep the local re-export
  to avoid churn.
- Gate: existing credential tests pass.

## Task 5 - Acceptance Wiring

- Register `silo` collect tests in `test-capabilities` and `gate-smoke-contracts`.
- Add a changeset.
- Final gate: `pnpm -C packages/silo run lint && pnpm -C packages/silo run type-check && pnpm -C packages/silo run test`.

## Explicit Non-Goal

Do not migrate `vault-seed/packages/cli/src/silo.js` in this item. That is item 8a and needs its own
consumer bridge spec.
