# ADR-XXX: [Decision Title]

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-YYY  
**Date**: YYYY-MM-DD  
**Deciders**: [Who made the decision]  
**Related**: [Links to relevant ADRs, issues, docs]

---

## Context

Brief description of the problem or situation requiring a decision.

**Current situation:**

- What exists today?
- Why is this decision needed?
- What constraints exist?

---

## Decision

Clear statement of the decision made.

**We will [action/choice].**

---

## Alternatives Considered

### Option 1: [Name]
**Pros:**

- Advantage 1
- Advantage 2

**Cons:**

- Disadvantage 1
- Disadvantage 2

### Option 2: [Name]
**Pros:**

- Advantage 1

**Cons:**

- Disadvantage 1

### Chosen: Option X
**Rationale**: Why this option was selected.

---

## Consequences

**Positive:**

- Benefit 1
- Benefit 2

**Negative:**

- Trade-off 1
- Trade-off 2

**Risks:**

- Risk 1 (mitigation: ...)
- Risk 2 (mitigation: ...)

---

## Operationalization (How this becomes actionable)

**Entry criteria to start implementation:**

- [ ] Affected boundaries/components are explicit
- [ ] Compatibility/migration expectation is explicit
- [ ] Observability/verification expectation is explicit

**BDD first slice (behavior, red):**

- Scenario file(s): `...`
- Expected first failing assertion: `...`

**TDD contract slice (unit, red):**

- Contract file(s): `...`
- Critical edge cases: `...`

**DDD implementation slice (green):**

- First production modules to implement: `...`
- Done when: `...`

**Verification commands:**

- Red (BDD): `pnpm ...`
- Red (TDD): `pnpm ...`
- Green (full): `pnpm ...`

---

## Implementation

**Affected components:**

- Component A
- Component B

**Migration path** (if needed):

1. Step 1
2. Step 2

**Timeline**: When this should be implemented

---

## References

- [Technical Research](../../docs/research/phase1-technical-foundations.md)
- [W3C Spec](https://example.com)
- [GitHub Issue #123](https://github.com/...)
