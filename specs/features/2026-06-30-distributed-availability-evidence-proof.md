# Distributed Availability Evidence Proof

**Status**: Implemented proof
**Date**: 2026-06-30
**Related**: ADR-075, ADR-074, `artifact-contract-v1`, `release-engine`,
`validations/distributed-availability-evidence`

## Problem

ADR-075 adopts Pears/Holepunch as a reference model for platform shape, but Refarm must not jump
from inspiration to runtime/storage adoption. Before claiming distributed install/update or P2P
availability, Refarm needs a small proof that its existing manifests can describe:

- what is being distributed;
- what updates it;
- who keeps it available;
- how it rolls back;
- which trust evidence promoted it.

## Decision

Create a proof-local validation under `validations/distributed-availability-evidence`. The proof
uses existing Refarm blocks and deliberately avoids package extraction.

The proof envelope must include:

- stable proof-local distribution identity;
- availability policy with at least one primary seed and one replica fixture;
- read-only remote-node evidence and an environment-ceiling requirement;
- update evidence sourced from `release-engine`;
- rollback target evidence;
- `release-engine` audit digest evidence;
- `artifact-contract-v1` task artifact manifest evidence;
- explicit boundaries that runtime/storage/P2P adoption is false.

## Non-Goals

- No public install/update contract.
- No package extraction.
- No `apps/refarm` ownership.
- No Bare, Hypercore, Hyperdrive, Corestore, Hyperswarm, HyperDHT, or Pear runtime adoption.
- No product-ready P2P substrate claim.

## Promotion Triggers

Promote this proof into a package or public contract only when at least one of these pressures
exists:

- Refarm dogfoods install/update/rollback evidence for a real plugin, package selection, remote
  node, generated distribution, or Tractor surface;
- `vault-seed` or `agents-lab` needs to consume the same neutral availability envelope;
- a second operator surface needs to inspect availability/update state;
- release policy needs a stable install/update evidence subpath.

## Validation

Focused validation:

```bash
pnpm run distributed-availability:poc:test
```

The test must prove that missing rollback evidence, missing replica evidence, or substrate adoption
claims fail before this can be presented as distributed availability.
