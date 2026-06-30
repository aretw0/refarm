# Distributed Availability Evidence Proof Plan

**Status**: Implemented
**Spec**: `specs/features/2026-06-30-distributed-availability-evidence-proof.md`
**Validation**: `pnpm run distributed-availability:poc:test`

## Tasks

1. Define a proof-local distribution identity.
   - Done in `buildDistributionIdentity`.
   - Uses `refarm-proof://` and a package-selection subject.

2. Define availability policy evidence.
   - Done in `buildAvailabilityPolicy`.
   - Requires a primary seed, replica fixture, read-only remote-node evidence, and environment
     ceiling requirement.

3. Define update and rollback evidence.
   - Done in `buildUpdateAndRollbackEvidence`.
   - Current and rollback versions are distinct and evidence references are explicit.

4. Compose trust evidence from existing Refarm blocks.
   - Done in `buildReleaseTrustEvidence`.
   - Uses `release-engine` audit digest and keeps the fixture marked as proof-only.

5. Emit artifact evidence.
   - Done in `buildTaskArtifactManifest`.
   - Uses `artifact-contract-v1` manifest shape with the release audit digest as input hash.

6. Add boundary tests.
   - Done in `distributed-availability-evidence.test.mjs`.
   - Verifies no package extraction, app ownership, product-ready claim, Bare adoption,
     Hypercore-family adoption, Pear runtime adoption, or generic P2P substrate adoption.

7. Update planning docs.
   - Done in the convergence roadmap, factory readiness ledger, ecosystem supply map, decision log,
     and validations README.
