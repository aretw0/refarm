# Artifact/Lab Evidence Bridge

> Goal: make Lab datasets, publication outbox manifests, and notebook snapshots
> consumable as generic task artifact evidence without moving notebook UX, vault
> schema, or provider behavior upstream.

## Task 1 - Contract Proof

- [x] Keep `@refarm.dev/artifact-contract-v1` roles generic: `dataset`,
  `manifest`, `report`, `receipt`, and related task-output roles.
- [x] Prove `vault-seed` Lab/outbox/notebook evidence through labels and media
  types, not new DGK-specific roles.
- [x] Validate the fixture with `validateTaskArtifactManifest`.

## Task 2 - Handoff

- [x] Build and test `@refarm.dev/artifact-contract-v1`.
- [x] Pack the candidate tarball for the `vault-seed` handoff.
- [x] Record the packet in readiness and convergence docs.

2026-06-26 packet:
- Candidate tarball:
  `.refarm/handoff/vault-seed/2026-06-26/refarm.dev-artifact-contract-v1-0.1.0.tgz`
  (`sha256 75c6c0f746435ae6b91ff009178b2a5f367e020f616eda33a3e11f54dd1caa08`).
- Tarball contents are limited to `dist/`, `package.json`, `README.md`, and
  `LICENSE`.
- Local validation: `pnpm --filter @refarm.dev/artifact-contract-v1 run test`
  and `pnpm --filter @refarm.dev/artifact-contract-v1 run build`.

## Downstream Proof

The official `vault-seed` checkout should emit `refarm.task-artifacts.v1`
manifests from its Lab dataset, publication outbox, and notebook export
producers. The proof should keep notebook routes, PARA folders, provider API
calls, and `dgk` command UX downstream-owned.
