# Vault-Seed Ready Handoff Packet

> Goal: make the local candidate channel match the full `vault-seed-ready`
> release-policy selection before public publication or official downstream
> assimilation.

## Task 1 - Selection Parity

- [x] Confirm `node scripts/release-check.mjs --selection vault-seed-ready --plan --json`
  lists 10 packages.
- [x] Ensure `.refarm/handoff/vault-seed/2026-06-26/` has one tarball for each
  selected package.
- [x] Record SHA256 checksums in the convergence docs.

## Task 2 - Focused Validation

- [x] Validate `@refarm.dev/effort-contract-v1` with package test and build.
- [x] Validate `@refarm.dev/release-engine` with its package test.
- [x] Validate `@refarm.dev/dispatch-surface` with its package test, which runs
  the build first.

## Task 3 - Downstream Rule

Official `vault-seed` assimilation remains downstream. Pre-publication consumers
should install from the local handoff directory and override unpublished
workspace dependencies to the matching tarballs. Known direct pairings:

- `@refarm.dev/dispatch-surface` -> `@refarm.dev/effort-contract-v1`;
- `@refarm.dev/silo` -> `@refarm.dev/heartwood`;
- `@refarm.dev/homestead-ssr` -> `@refarm.dev/ds`.

This packet is a candidate channel, not a public release.
