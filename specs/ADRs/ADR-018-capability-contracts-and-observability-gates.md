# ADR-018: Capability Contracts and Observability Gates

**Status**: Accepted  
**Date**: 2026-03-07  
**Deciders**: Refarm core maintainers  
**Related**: ADR-007, ADR-013, ADR-017

---

## Context

A plugin-first architecture only works safely when every plugin implementation is measurable, verifiable, and replaceable.

Refarm explicitly requires:

- third-party alternative backends
- strict production observability
- reliable swap between providers without app rewrites

Without enforceable contracts and telemetry gates, ecosystem scale causes runtime fragility and opaque failures.

---

## Decision

**We will enforce capability contracts with mandatory observability hooks and conformance tests before plugin admission.**

### Contract model

Each capability MUST define:

1. versioned API (`capability:vN`)
2. functional semantics (expected behavior)
3. error model (typed codes)
4. performance expectations (SLO hints)
5. required telemetry events/metrics

### Admission model

A plugin implementation is admissible only if it passes:

1. conformance tests (functional)
2. telemetry compliance tests
3. safety checks (capabilities/permissions)
4. compatibility checks (manifest + semver)

---

## Alternatives Considered

### Option 1: Best-effort plugin quality (no gates)

**Pros:**

- fastest onboarding
- low process overhead

**Cons:**

- inconsistent behavior
- poor diagnosability
- high operational risk

### Option 2: Manual review-only governance

**Pros:**

- flexible policy interpretation
- moderate setup effort

**Cons:**

- non-scalable
- subjective quality
- delayed incident detection

### Chosen: Option 3 (Automated contracts + observability gates)

**Rationale**: scalable, objective, and aligned with a high-reliability ecosystem.

---

## Consequences

**Positive:**

- deterministic integration quality
- improved incident triage and root-cause speed
- portable plugin ecosystem with stronger trust

**Negative:**

- higher initial SDK and tooling investment
- stricter entry barrier for third-party authors

**Risks:**

- over-constrained innovation (mitigation: evolve contracts via versioning)
- observability overhead (mitigation: lightweight structured event schema)

---

## Implementation

**Affected components:**

- capability specs and SDK packages
- CI quality gates for plugin packages
- inspector tooling for telemetry validation

**Migration path:**

1. establish `storage:v1` as reference contract
2. ship conformance runner in repo
3. enforce conformance in CI for internal implementations
4. publish third-party authoring guide

**Timeline:** starts in v0.1.x foundation phase, extends continuously.

---

## References

- [docs/PR_QUALITY_GOVERNANCE.md](../../docs/PR_QUALITY_GOVERNANCE.md)
- [docs/WORKFLOW.md](../../docs/WORKFLOW.md)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/)
