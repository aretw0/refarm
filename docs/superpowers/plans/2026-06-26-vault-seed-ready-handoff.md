# Vault-Seed Ready Handoff Packet

> Goal: make the local candidate channel match the full `vault-seed-ready`
> release-policy selection before public publication or official downstream
> assimilation.

> Current-state note (2026-07-02): this plan captured the historical 2026-06-26
> packet, when `homestead-ssr` was still present. ADR-072 removed
> `homestead-ssr` pre-publication, so the active `vault-seed-ready` selection is
> now 20 packages and 58 required checks after the T3 consumer proof, selected
> `records-contract-v1` YAML unit gate, T2 credentials pull (`credentials:v1` +
> identity/storage contracts + Heartwood/storage-memory reference providers),
> agent-demo public-surface proof, `quality:v1` pull, and generic
> `content-projection` pull for Markdown/MDX note projection. Use the generated
> handoff manifest as the source of truth for current package lists.

> Refresh (2026-07-03): the current packet was materialized under
> `.refarm/handoff/vault-seed/2026-07-03/` with 20 tarballs plus
> `manifest.json` and `manifest.md`. The generated manifest reports
> `ok: true`, `acceptance.status: "accepted"`, 20 packages, 4 required gates,
> 58 required checks, no missing/extra/issues, `distributionEvidence.state:
> "local-handoff-ready"`, one verified local copy, 20 consumer proofs, and a
> clean release-boundary audit. The official `vault-seed` checkout was not
> visible from this devcontainer during the refresh.
> Proof receipt (2026-07-03): the official `vault-seed` checkout later copied
> this packet, verified all 20 tarballs against `manifest.json`, refreshed
> lockfile integrity, ran focused consumer proofs, and recorded the evidence in
> `vault-seed` at `docs/convergencia-refarm-proof-2026-07-03.md`.
> Follow-up in the same date packet: `@refarm.dev/ds` now includes the
> `@refarm.dev/ds/quality-checker` subpath, a thin `quality:v1` adapter over
> `ds-lint:v1`. The handoff was rematerialized after the package change; the DS
> tarball SHA-256 is
> `9504c4682971338fc4d7c70e288c03c0be7a8619b415b7a45348a7a5dbe4c48b`.
> Follow-up in the same date packet: `@refarm.dev/content-projection` now
> includes Markdown inline-link support. Local links can resolve to records;
> external links are preserved as projected metadata so the output remains valid
> under `records:v1`.

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
