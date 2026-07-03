# Feature: [Feature Name]

**Status**: Draft | In Progress | Implemented  
**Version**: Target version (e.g., v0.1.0)  
**Owner**: [Responsible person/team]

---

## Summary

One-paragraph description of what this feature does and why it matters.

---

## Scope and Boundary

**In scope**:

- [ ] Item 1
- [ ] Item 2

**Out of scope**:

- [ ] Item 1
- [ ] Item 2

---

## User Stories

**As a** [user type]  
**I want** [goal]  
**So that** [benefit]

---

## Acceptance Criteria

Given-When-Then format for BDD tests:

1. **Given** [precondition]  
   **When** [action]  
   **Then** [expected outcome]

2. **Given** [precondition]  
   **When** [action]  
   **Then** [expected outcome]

---

## Bounded Context and Ubiquitous Language (DDD)

**Bounded context**: [context name]

**Core entities / value objects**:

- [ ] Entity/VO 1
- [ ] Entity/VO 2

**Ubiquitous language terms**:

- [ ] Term 1 -> [exact meaning]
- [ ] Term 2 -> [exact meaning]

---

## Technical Approach

**High-level design:**

- Architecture overview
- Components involved
- Data flow

**Key decisions:**

- Link relevant ADRs
- Technical constraints
- Dependencies

---

## API/Interface

```typescript
// Public interfaces (if applicable)
interface FeatureInterface {
  method(param: Type): ReturnType;
}
```

---

## Traceability Matrix (SDD -> BDD -> TDD -> DDD)

| Requirement / Decision | SDD source | BDD test file | TDD test file | DDD implementation |
| --- | --- | --- | --- | --- |
| Behavior A | specs/features/... | tests/integration/... | src/...test.ts | src/...ts |
| Behavior B | specs/ADRs/... | tests/integration/... | src/...test.ts | src/...ts |

---

## Test Coverage

**Integration tests** (BDD):

- [ ] Test scenario 1
- [ ] Test scenario 2

**Unit tests** (TDD):

- [ ] Contract 1
- [ ] Contract 2

---

## Implementation Tasks

**SDD:**

- [ ] Define interfaces
- [ ] Write ADRs (if needed)

**BDD:**

- [ ] Write integration tests

**TDD:**

- [ ] Write unit tests

**DDD:**

- [ ] Implement domain logic
- [ ] Implement infrastructure

---

## Execution Plan (Red -> Green)

**Gate 1 (SDD ready):**

- [ ] ADR/spec approved
- [ ] No TODO/TBD in critical sections

**Gate 2 (BDD red):**

- [ ] Integration/behavior tests added and failing
- [ ] Failure is from missing behavior (not flaky infra)

**Gate 3 (TDD red):**

- [ ] Unit/contract tests added and failing
- [ ] Public contract and edge cases covered

**Gate 4 (DDD green):**

- [ ] BDD tests pass
- [ ] TDD tests pass
- [ ] Public API/docs updated

**Evidence commands (fill with real commands used in this feature):**

- BDD red: `pnpm ...`
- TDD red: `pnpm ...`
- Green/full verify: `pnpm ...`

---

## References

- [ADR-XXX](../ADRs/ADR-XXX-title.md)
- [Technical Research](../../docs/research/...)
- [Related Issue #123](https://github.com/...)
