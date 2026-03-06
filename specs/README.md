# Refarm Specifications

**Spec Driven Development (SDD)**: Write specifications before code.  
**Process**: Part of [SDD → BDD → TDD → DDD workflow](../docs/WORKFLOW.md)

---

## Structure

```
specs/
├── ADRs/          Architecture Decision Records
├── features/      Feature specifications
├── diagrams/      Mermaid architecture and systems diagrams
└── README.md      This file
```

---

## Architecture Decision Records (ADRs)

**Purpose**: Document important architectural decisions.

**When to write**:

- Before implementing major features
- When choosing between alternatives
- When establishing patterns/conventions

**Format**: See [ADRs/template.md](ADRs/template.md)

**Index**: [ADRs/README.md](ADRs/README.md)

---

## Feature Specifications

**Purpose**: Define feature behavior before implementation.

**When to write**:

- Before starting new features
- To clarify requirements
- As basis for BDD/TDD tests

**Format**: See [features/template.md](features/template.md)

---

## SDD Process

**SDD is Phase 1 of the [Development Workflow](../docs/WORKFLOW.md)**

1. **Write Spec** → Clarify what you're building (ADRs + feature specs)
2. **Review Spec** → Peer review, validate approach
3. **Gate**: No TODOs, complete specs → Proceed to BDD
4. **Next**: BDD (integration tests FAIL) → TDD (unit tests FAIL) → DDD (implementation)

See [WORKFLOW.md](../docs/WORKFLOW.md) for complete process and quality gates.

---

## References

- **Workflow**: [docs/WORKFLOW.md](../docs/WORKFLOW.md) - SDD→BDD→TDD→DDD process
- **Technical Research**: [docs/research/](../docs/research/) - Wiki of technical foundations
- **Roadmaps**: [roadmaps/](../roadmaps/) - Version planning & milestones
- **Architecture**: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) - System overview
