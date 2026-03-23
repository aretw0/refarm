# Scarecrow (Policy & Validation) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Policy Foundation (DONE/In Progress)
**Scope**: Establish core validation rules and policy engine.  
**Gate**: Verified manifest and node validation logic.

### SDD (Spec Driven) ✅
- [x] Spec: `refarm:scarecrow` policy contract.
- [x] Spec: JSON-LD node validation schema.

### BDD (Behaviour Driven) ✅
- [x] Integration: Nodes correctly rejected if failing policy check.
- [x] Integration: Heartwood signatures verified before plugin registration.

### TDD (Test Driven) ✅
- [x] Unit: Policy matching and rule evaluation.
- [x] Coverage: >85% (Security Critical)

### DDD (Domain Implementation) ✅
- [x] Domain: Core `scarecrow` policy engine.
- [x] Infra: Node.js and Browser validation adapters.

---

## v0.2.0 - Sovereign Graph Protection
**Scope**: Enforcing policies at the storage and sync boundaries.

- [ ] Implementation of **Ingestion Filtering**: Automatically running Scarecrow checks during `Sower` ingestion.
- [ ] **Sync Validation**: Rejecting incoming sync deltas from `Sync-Loro` if they violate user-defined policies.

---

## v0.3.0 - Sovereign Web Guardian
**Scope**: Protecting the user from external web threats via the Refarm distros.

- [ ] Implementation of **Intent Policy Gating**: Enforcing user approval for high-risk sovereign intents.
- [ ] **Malicious Node Detection**: (Planned) Using `plugin-tem` to detect structural anomalies that indicate malicious injection.

---

## Notes
- See [packages/scarecrow/src/index.js](./src/index.js) for core logic.
- The "Guardian" of the sovereign farm — keeping the crows away from the user's data.
