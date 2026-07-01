# Vault-Seed Ready Handoff Packet

> Goal: make the local candidate channel match the full `vault-seed-ready`
> release-policy selection before public publication or official downstream
> assimilation.

> Current-state note (2026-07-01): this plan captured the historical 2026-06-26
> packet, when `homestead-ssr` was still present. ADR-072 removed
> `homestead-ssr` pre-publication, so the active `vault-seed-ready` selection is
> now 18 packages and 49 required checks after the T3 consumer proof, selected
> `records-contract-v1` YAML unit gate, and T2 credentials pull
> (`credentials:v1` + identity/storage contracts + Heartwood/storage-memory
> reference providers). Use the generated handoff manifest as the source of truth
> for current package lists.

## Task 1 - Selection Parity

- [x] Confirm `node scripts/release-check.mjs --selection vault-seed-ready --plan --json`
  lists 10 packages.
- [x] Ensure `.refarm/handoff/vault-seed/2026-06-26/` has one tarball for each
  selected package.
- [x] Confirm `pnpm run release:vault-seed:handoff -- --json` reports
  `acceptance.status: "accepted"` with 10 packages and 24 required checks.
- [x] Record SHA256 checksums in the convergence docs.

## Task 2 - Focused Validation

- [x] Validate `@refarm.dev/effort-contract-v1` with package test and build.
- [x] Validate `@refarm.dev/release-engine` with its package test.
- [x] Validate `@refarm.dev/dispatch-surface` with its package test, which runs
  the build first.

## Task 3 - Downstream Rule

Official `vault-seed` assimilation remains downstream. Pre-publication consumers
should install from the local handoff directory and override unpublished
workspace dependencies to the matching tarballs when those optional or direct
surfaces are exercised. Known pairings:

- `@refarm.dev/dispatch-surface` -> `@refarm.dev/effort-contract-v1`;
- identity-only: `@refarm.dev/silo` -> `@refarm.dev/heartwood`
  (`SiloCore` storage helpers do not require this closure);
- historical only: `@refarm.dev/homestead-ssr` -> `@refarm.dev/ds`; ADR-072
  replaced this with direct `@refarm.dev/ds/html` consumption before public
  release.

This packet is a candidate channel, not a public release.

## Task 4 - Acceptance Handoff

- [x] `scripts/vault-seed-ready-handoff.mjs` propagates `releasePlanAcceptance`
  into both blocked and ready manifests.
- [x] The Markdown handoff prints `Acceptance: accepted (10 package(s), 24
  required check(s))` before the tarball table.
- [x] `pnpm run release:readiness:test` covers the acceptance field and Markdown
  summary through `scripts/ci/test-vault-seed-ready-handoff.mjs`.
- [x] The handoff manifest now carries `distributionEvidence` with stable/current
  local handoff refs, tarball integrity, update source, rollback target, and
  boundaries that keep the packet out of public install/P2P claims.

## Task 5 - Freshness Guard

- [x] The handoff manifest rejects stale tarballs when package source-level
  inputs such as `package.json`, `README.md`, `src/`, `wit/`, or Cargo metadata
  are newer than the handoff tarball.
- [x] The manifest also rejects publishable `dist/` or `pkg/` output when
  source build inputs are newer, so a freshly packed tarball cannot hide stale
  build artifacts.
- [x] Stale tarballs are reported as explicit `issues` so consumer-pulled
  packets cannot look ready after local SDK docs or source changed.
