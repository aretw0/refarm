# ADR-073: Capability Index Incubation Boundary

**Status**: Accepted
**Date**: 2026-06-30
**Authors**: Arthur Silva, Codex
**Related**: ADR-018 (Capability Contracts and Observability Gates), ADR-046 (Blocks and
Distros), ADR-067 (Capability-Driven Plugin Observer Routing), ADR-072 (Consumer Leaf
Distribution Policy), `docs/ECOSYSTEM_SUPPLY_MAP.md`, `docs/decision-log.md`

---

## Context

Refarm now exposes reference-driver discovery through
`@refarm.dev/cli/capability-index` and `refarm capabilities`. The surface is useful for dogfood,
release planning, and downstream assimilation rehearsals, but the word "capability" already carries
other architectural meanings in Refarm:

- runtime/plugin capabilities declared by plugin manifests and enforced by Tractor/Barn/Scarecrow
  policy;
- versioned capability contracts with conformance and observability gates;
- consumer-pulled package leaves selected for `vault-seed-ready` handoffs;
- transitional maps that explain how `vault-seed` and `agents-lab` can stop duplicating Refarm
  substrate.

Without an explicit boundary, `@refarm.dev/cli` can become the accidental owner of supply-chain
truth, or `apps/refarm` can become the accidental product owner of reusable primitives. Both outcomes
would violate ADR-046 and ADR-072.

## Decision

Refarm will treat the current capability index as an **incubating operator/discovery surface**, not
as the long-term public owner for every capability concept.

The surface is split by purpose:

- **Capability registry**: durable runtime/plugin knowledge. This belongs to plugin manifests,
  Barn/Tractor routing, and future package-owned runtime registry work. It answers "what can execute
  or be routed in this environment?"
- **Supply/readiness index**: durable operator/release knowledge. It answers "which Refarm primitive
  is supplyable, blocked, private, or ready for a downstream proof?"
- **Assimilation map**: transitional or semi-transitional downstream planning. It answers "what can
  `vault-seed` or `agents-lab` replace with Refarm once a package or subpath is proven?"

`@refarm.dev/cli/capability-index` may continue to incubate the reference-driver supply/readiness
index because the CLI is the operator entrypoint and current dogfood consumer. That placement is
explicitly **boundary-review**, not a `vault-seed-ready` install leaf.

`apps/refarm` and other apps may render or consume package-owned discovery data, but they must not
become the source of truth for capability ownership, package promotion, or runtime dispatch policy.

## Promotion Rules

Before promoting this surface as a long-lived package or public dependency, choose the narrowest
correct owner:

- extract to `@refarm.dev/capability-index` only if multiple non-CLI consumers need a stable
  supply/readiness SDK without CLI install closure;
- extract to `@refarm.dev/reference-driver` only if the data becomes part of the reference-driver
  engine contract rather than general supply/readiness planning;
- keep it under `@refarm.dev/cli/capability-index` while it is mainly an operator discovery,
  release preflight, or dogfood planning surface;
- keep runtime/plugin capability truth in plugin manifests, Barn, Tractor, policy packages, or a
  future runtime registry package, not in the supply/readiness index.

Promotion requires at least one of these signals:

- a second real consumer outside CLI/app rendering needs the SDK;
- install closure of `@refarm.dev/cli` blocks a legitimate consumer;
- release or CI depends on the JSON shape as a stable contract;
- a public tgz/npm handoff would otherwise force downstream users to install the CLI package;
- reference-driver runtime semantics, not only release posture, need a package-owned API.

## Consequences

### Positive

- The current work remains useful instead of being abandoned as transition-only.
- Refarm avoids publishing a long-term package boundary before the consumers prove the shape.
- `apps/refarm` stays a thin dogfood surface.
- Barn/Tractor plugin capability authority remains separate from supply/readiness planning.
- `vault-seed` can keep rehearsing assimilation without depending on a not-yet-public CLI leaf.

### Negative

- The CLI package temporarily carries an incubating subpath whose final owner is not settled.
- Documentation and tests must keep distinguishing capability meanings.
- Future extraction may still be a breaking pre-publication move if the second-consumer signal
  arrives.

### Risks

- The incubating subpath may accrete too much release policy. Mitigation: new supply/readiness fields
  should be rejected unless they are needed by dogfood, release preflight, or a named downstream
  proof.
- Downstream users may treat `@refarm.dev/cli/capability-index` as vault-seed-ready. Mitigation:
  `publicationBoundary.consumerInstallPolicy` remains `not-vault-seed-ready`, and release policy
  must keep `@refarm.dev/cli` out of `vault-seed-ready`.
- Runtime capability routing may be confused with supply readiness. Mitigation: runtime/plugin
  capability truth remains owned by plugin manifests, Barn, Tractor, and policy contracts.

## Implementation

1. Keep the current reference-driver supply/readiness payload under
   `@refarm.dev/cli/capability-index` while it remains operator-owned.
2. Keep `apps/refarm` as a renderer/consumer of package-owned capability data.
3. Document `capability registry`, `supply/readiness index`, and `assimilation map` as separate
   concepts in the ecosystem supply map.
4. Add audience-boundary tests that prevent the current incubating subpath from being described as a
   `vault-seed-ready` leaf or as Barn's plugin catalog.
5. Revisit extraction when one of the promotion signals above is observed.
