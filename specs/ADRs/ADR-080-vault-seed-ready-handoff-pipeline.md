# ADR-080: The `vault-seed-ready` Handoff Pipeline as Pre-Publication Release Vehicle

**Status**: Proposed
**Scope**: This is deliberately **temporary scaffolding** ("puxadinho"), not product surface. It
exists only so the official `vault-seed` checkout can validate blocks while Refarm is not yet on
npm/cargo. Investment in it is capped (see Sunset) — no growing test suite, no new packages, no
long-lived conventions beyond what already shipped.
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
the `vault-seed-ready` release-policy selection (currently 21 packages tagged in
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
3. **Split canon (closed, 2026-07-03).** Consumer-pull metadata originally lived both in the
   script's hardcoded map and inline in `refarm.config.json` package profiles. The release policy is
   now canonical: every selected `vault-seed-ready` profile carries complete `consumerPull`
   metadata, the handoff script derives `consumerProofs` from that policy, and
   `release-boundary-audit` blocks selected packages without the required fields.

---

## Decision

**We will treat the handoff pipeline as interim pre-publication scaffolding, with the generated
`manifest.json` — never prose — as the packet's source of truth, hardened only enough to not
mislead its one consumer:**

1. **Manifest is mandatory (shipped).** A packet directory without `manifest.json` is not a
   packet. A `--pack`/`--prune-extra` run writes `manifest.json`/`manifest.md` beside the
   tarballs and stamps `generatedAt` plus the source git SHA (landed 2026-07-03). No further CI
   guard is added for this lane — the self-describing script is enough for scaffolding.
2. **Downstream proofs return receipts — as plain files, not machinery.** If official proofs
   happen while still pre-publication, the consumer checkout drops a plain JSON file per proof
   beside the packet (`.refarm/handoff/vault-seed/<date>/receipts/<proofId>.json`) with
   `proofId`, consumer commit, manifest sha256, commands run, and result. No schema package, no
   validator, no CI — a receipt is memory, not product. If publication happens first, skip this
   entirely and prove against registry versions.
3. **Consumer-pull canon is the release policy.** `refarm.config.json` inline `consumerPull` is the
   only source for selected package proof metadata. The handoff script must not keep a parallel
   package-name map; it reads `releaseCheck.plan.orderedPackages[].profile.consumerPull` and flattens
   those entries into `consumerProofs`.
4. **Retention.** Manifest-bearing packet directories are the rollback chain and are kept until
   sunset. Manifest-less directories are invalid artifacts: regenerate or delete them (with
   operator confirmation); they must never be a handoff source.

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

## Sunset (explicit end-of-life)

The cheapest way to retire this scaffolding is the publish decision itself. On the first official
npm/cargo publication of the `vault-seed-ready` selection:

1. The handoff lane stops being the release vehicle — consumers pin registry versions and drop
   `file:./vendor/*.tgz` specs and `pnpm.overrides`.
2. No new packets are generated; existing manifest-bearing directories remain as frozen
   historical evidence (they may be archived or deleted at the operator's discretion — they stop
   being a rollback chain once the registry is the source of truth).
3. `scripts/vault-seed-ready-handoff.mjs`, its test, and the `release:vault-seed:handoff` alias
   are candidates for removal; anything still useful (acceptance summary, boundary audit) already
   lives in release-engine/release-check, not in this script.
4. This ADR flips to **Superseded** by whatever ADR records the public distribution contract —
   done "the least improvised way possible", designed then, not inherited from this stopgap.

Until then, the investment cap holds: bug fixes yes; new conventions, suites, or packages around
the handoff lane, no.

## Implementation

**Already landed (2026-07-03):** manifest-by-default + `generatedAt`/git-SHA stamps with unit
tests (`scripts/vault-seed-ready-handoff.mjs`); boundary audit in the first-publish workflow;
held baselines decoupled from the lane's changesets.

**Remaining (conditional, capped):**

1. Accept this ADR (records the stopgap and its sunset).
2. Receipts as plain JSON files only if downstream tranches run before publication.
3. Everything else waits for the publish decision — the preferred resolution.

---

## References

- `.refarm/handoff/vault-seed/2026-07-03/manifest.json` (current accepted packet: 21 packages, 63 required checks, `acceptance.status: "accepted"`)
- 2026-07-02 half-packet incident: 18 tarballs, no manifest, 16/18 sha256 drift vs 2026-07-01
  (verified 2026-07-03)
- `docs/superpowers/plans/2026-07-03-refarm-vault-seed-release-convergence.md` (walking order)
