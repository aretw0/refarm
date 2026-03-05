# [Package/App Name] - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../docs/WORKFLOW.md))

---

## v0.1.0 - [Milestone Name]
**Scope**: Brief description of what this version achieves  
**Depends on**: List other packages if needed

### SDD (Spec Driven)

**Goal**: Define interfaces and decisions BEFORE tests/code  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-XXX: Major decision about [topic]
- [ ] Spec: Public interface definition
- [ ] Spec: Domain model/contracts

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)  
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] Integration: [Feature behavior description]
- [ ] Integration: [Error handling scenario]
- [ ] Acceptance: [User-facing outcome]

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: [Contract 1]
- [ ] Unit: [Contract 2]
- [ ] Coverage: Target %

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: [Core logic component]
- [ ] Domain: [Business rules]
- [ ] Infra: [Adapters/infrastructure]
- [ ] Infra: [External integrations]

### CHANGELOG

```
## [0.1.0] - YYYY-MM-DD
### Added
- Feature X
- API Y

### Changed
- Behavior Z

### Fixed
- Bug W
```

---

## v0.2.0 - [Next Milestone]
*(Details after v0.1.0 completion)*

---

## Notes

- Link to relevant ADRs in specs/ADRs/
- Link to technical research in docs/research/
- Track blockers and dependencies explicitly
