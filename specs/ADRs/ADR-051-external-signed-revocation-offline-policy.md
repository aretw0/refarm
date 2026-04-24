# ADR-051: External-Signed Revocation Offline Policy Profiles

**Status**: Proposed  
**Date**: 2026-04-24  
**Deciders**: Refarm Core Team  
**Related**: [ADR-044](ADR-044-wasm-plugin-loading-browser-strategy.md), [DEC-018](../../.project/decisions.json), [DEC-026](../../.project/decisions.json), [Runtime Descriptor External-Signed Alignment](../../docs/RUNTIME_DESCRIPTOR_EXTERNAL_SIGNED_ALIGNMENT.md)

---

## Context

The `external-signed` descriptor path now enforces integrity/provenance and revocation checks in install/runtime flows.
However, revocation source availability is not uniform across environments:

- local/dev needs delivery velocity and resilience to transient infra failures;
- staging needs signal quality while preserving validation continuity;
- production-sensitive environments need security-first behavior.

Current implementation already supports explicit policy knobs (`fail-open`, `stale-allowed`, `fail-closed`) but defaults must be standardized by environment profile.

---

## Decision

**We will adopt profile-driven revocation-unavailable behavior with deterministic precedence and explicit overrides.**

Profile mapping target:

- `dev` → `fail-open`
- `staging` → `stale-allowed`
- `production-sensitive` → `fail-closed`

Precedence target:

1. explicit policy
2. explicit profile
3. environment policy
4. environment profile
5. caller fallback

Operational observability target:

- emit explicit signal when stale cache fallback is used (`system:descriptor_revocation_stale_cache_used`)
- emit explicit signal when fail-open bypass is applied (`system:descriptor_revocation_unavailable`)

---

## Alternatives Considered

### Option 1: Single global default (`fail-closed` everywhere)

**Pros:**

- Simple mental model
- Strong baseline posture

**Cons:**

- High DX friction in local/dev
- Can block non-critical staging flows for transient errors

### Option 2: Single global default (`stale-allowed` everywhere)

**Pros:**

- Better resilience to temporary outages
- Fewer delivery interruptions

**Cons:**

- Not strict enough for sensitive production
- Can mask critical revocation distribution failures

### Option 3: Profile-driven policy (chosen)

**Pros:**

- Aligns risk posture with environment intent
- Preserves DX while keeping hardened production behavior
- Supports gradual rollout through explicit overrides

**Cons:**

- Requires clear governance and docs to avoid ambiguity
- Slightly higher configuration surface

### Chosen: Option 3

**Rationale**: matches existing governance trajectory (`DEC-026`) and operational reality of mixed environments without forcing one-size-fits-all trade-offs.

---

## Consequences

**Positive:**

- Deterministic and auditable policy resolution
- Reduced accidental regressions in revocation handling
- Better alignment between security and delivery constraints

**Negative:**

- More inputs to reason about (policy/profile/env)
- Requires explicit communication in docs/playbooks

**Risks:**

- Misconfiguration by invalid env values (mitigation: deterministic normalization + fallback)
- Overuse of fail-open outside dev (mitigation: profile guidance + PR governance checks)

---

## Implementation

**Affected components:**

- `packages/tractor-ts/src/lib/runtime-descriptor-revocation-policy.ts`
- `packages/tractor-ts/src/lib/install-plugin.ts`
- `packages/tractor-ts/src/index.browser.ts`
- `packages/tractor-ts/test/*revocation*`
- `docs/RUNTIME_DESCRIPTOR_EXTERNAL_SIGNED_ALIGNMENT.md`

**Migration path:**

1. Introduce profile/policy resolver with deterministic precedence.
2. Wire install/runtime consumers to the resolver.
3. Add unit coverage for mapping + precedence.
4. Record rollout defaults by environment and promote `DEC-026` once accepted.

**Timeline**: staged rollout in phase 10 (transition-checkpoint) with verification slices.

---

## References

- [Runtime Descriptor External-Signed Alignment](../../docs/RUNTIME_DESCRIPTOR_EXTERNAL_SIGNED_ALIGNMENT.md)
- [ADR-044: WASM Plugin Loading — Browser Strategy](ADR-044-wasm-plugin-loading-browser-strategy.md)
- [Release smoke pipeline](../../scripts/ci/smoke-runtime-descriptor-release-path.mjs)
