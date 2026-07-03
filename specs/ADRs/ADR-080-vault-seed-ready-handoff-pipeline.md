# ADR-080: The `vault-seed-ready` Handoff Pipeline as Pre-Publication Release Vehicle

**Status**: Proposed
**Date**: 2026-07-03
**Authors**: Claude (from operator-directed audit), pending Arthur Silva review
**Related**: ADR-069 (npm Scope Canonicalization), ADR-072 (Consumer Leaf Distribution Policy),
ADR-075 (distribution evidence boundary), `docs/VAULT_SEED_CONVERGENCE.md`,
`docs/DEV_CROSS_REPO_CONSUMPTION.md`, `docs/v0.1.0-release-gate.md`,
`scripts/vault-seed-ready-handoff.mjs`, `docs/superpowers/plans/2026-06-26-vault-seed-ready-handoff.md`

---

## Context

While public npm publication is held behind the daily-driver gate, the **actual release vehicle**
of Refarm is the local tarball handoff packet: `pnpm run release:vault-seed:handoff` materializes
the `vault-seed-ready` release-policy selection (currently 19 packages tagged in
`refarm.config.json`) as tarballs plus a versioned `manifest.json`/`manifest.md` under a dated
`.refarm/handoff/vault-seed/<date>/` directory. The manifest carries `packages[].sha256`,
`consumerInstall` (file specs, pnpm overrides, revendor policy), `consumerProofs` (stable
`proofId`s with proof targets and ownership boundaries), `distributionEvidence`, and an embedded
`releaseBoundaryAudit` that blocks `ok: true` on naming/boundary violations.

This mechanism is release-critical and was, until this ADR, described only in docs prose. Three
failure classes have already occurred or are structurally open:

1. **Packet rot (occurred, 2026-07-02).** A pack-only run left a dated directory with 18 tarballs,
   no manifest, and no `quality-contract-v1` tarball — while 16 of its 18 tarballs had different
   bytes than the previous manifest-bearing packet under identical names/versions. This is exactly
   the revendor footgun the manifest exists to prevent, produced by the pipeline itself, because
   manifest emission is opt-in (`--out`) and nothing validates a packet directory's completeness.
2. **Unverifiable downstream "done" (open).** `consumerProofs` names what the official `vault-seed`
   checkout must prove, but no receipt ever returns. Completed proofs (T2/T3) exist only as prose in
   `docs/VAULT_SEED_CONVERGENCE.md` — prose that has already drifted from disk once.
3. **Split canon (open).** Consumer-pull metadata lives both in the script's hardcoded
   `VAULT_SEED_CONSUMER_PULLS` map and inline in `refarm.config.json` package profiles (only
   `@refarm.dev/quality-contract-v1` uses the config form). No rule says which is canonical.

---

## Decision

**We will treat the handoff pipeline as the governed pre-publication release vehicle, with the
generated `manifest.json` — never prose — as the packet's source of truth, and close the three
failure classes:**

1. **Manifest is mandatory.** A packet directory without `manifest.json` is not a packet. The
   handoff script must write the manifest by default (or refuse to pack without one) and stamp
   `generatedAt` plus the source git SHA. A completeness guard (tarball set == selection set,
   manifest present) runs in the release readiness lane so a half-packet fails loudly instead of
   rotting silently.
2. **Downstream proofs return receipts.** Each `consumerProofs[].proofId` is completed only by a
   machine-readable receipt recorded by the official consumer checkout and copied back beside the
   packet (`.refarm/handoff/vault-seed/<date>/receipts/<proofId>.json`), carrying at minimum:
   `proofId`, consumer repo + commit, packet directory + manifest sha256, commands run, result,
   and the product boundary confirmation. Docs may narrate; only receipts count as evidence.
3. **`refarm.config.json` is the consumer-pull canon.** The script's hardcoded map is legacy; new
   packages declare `consumerPull` in their package profile, and existing entries migrate
   opportunistically. The script merges but the config wins on conflict.
4. **Retention.** Manifest-bearing packet directories are the rollback chain and are kept.
   Manifest-less directories are invalid artifacts: regenerate or delete them (with operator
   confirmation); they must never be a handoff source.

---

## Alternatives Considered

### Option 1: Publish to npm immediately and drop the local packet lane
**Pros:** registry integrity for free; no custom manifest machinery.
**Cons:** violates the daily-driver release hold (`docs/v0.1.0-release-gate.md`); loses the
consumer-pulled proof loop that makes v0.1.0 evidence real.

### Option 2: Keep prose ledgers in docs as the record of packets and proofs
**Pros:** no tooling work.
**Cons:** empirically failed — the 2026-07-02 prose claimed a manifest and 19 tarballs that did
not exist on disk.

### Option 3: Track packets (tarballs) in git
**Pros:** history and diffing for free.
**Cons:** heavy binaries in history; `.refarm/` is deliberately local evidence, and
`distributionEvidence` already records the copy/rollback chain.

### Chosen: govern the existing pipeline (decision above)
**Rationale**: the machinery already exists and is proven; what failed is enforcement (manifest
optionality) and evidence closure (no receipts). Both are small, testable additions.

---

## Consequences

**Positive:**

- The official checkout can always verify integrity (`packages[].sha256`) and knows exactly which
  proofs are open — completion state stops living in unverifiable prose.
- Doc drift about packets becomes structurally impossible to miss: the readiness lane fails when
  disk and selection disagree.
- A second consumer lane can reuse the same shape (selection tag + consumerPull profiles +
  receipts) without inheriting vault-seed vocabulary.

**Negative:**

- Receipts add a manual copy step for the operator between checkouts (no shared filesystem by
  design).
- The completeness guard adds one more readiness check to maintain.

**Risks:**

- Receipts could be hand-written to "pass" (mitigation: they name commands and commit SHAs, which
  are auditable; the goal is memory, not adversarial proof).
- Guard too strict on historical directories (mitigation: guard applies only to the newest packet
  and to any directory named by docs as active).

---

## Implementation

**Affected components:**

- `scripts/vault-seed-ready-handoff.mjs` — manifest-by-default, `generatedAt` + git SHA stamp,
  receipt directory awareness.
- `scripts/ci/` — packet completeness guard wired into `release:readiness:test` (or the
  first-publish lane).
- `refarm.config.json` — consumerPull canon migration.
- `docs/VAULT_SEED_CONVERGENCE.md`, `docs/DEV_CROSS_REPO_CONSUMPTION.md` — point at receipts as
  the assimilation checklist.

**Migration path:**

1. Accept this ADR (records the already-shipped pipeline as the release vehicle).
2. Land the manifest-by-default + stamp change with its unit test.
3. Land the completeness guard.
4. Define the receipt JSON shape next to the manifest schema; first receipts come from the next
   downstream tranche (quality:v1 pull, silo 8a bridge).
5. Migrate `VAULT_SEED_CONSUMER_PULLS` entries into package profiles opportunistically.

**Timeline**: guards before the next packet generation; receipts with the next official
downstream proof.

---

## References

- `.refarm/handoff/vault-seed/2026-07-03/manifest.json` (current accepted packet: 19 packages,
  54 required checks, `acceptance.status: "accepted"`)
- 2026-07-02 half-packet incident: 18 tarballs, no manifest, 16/18 sha256 drift vs 2026-07-01
  (verified 2026-07-03)
- `docs/superpowers/plans/2026-07-03-refarm-vault-seed-release-convergence.md` (walking order)
