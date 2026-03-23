# Plugin Manifest - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Schema Foundation (DONE)
**Scope**: Establish the core JSON-LD schema for plugin metadata and capability requests.  
**Gate**: Verified manifest validation logic and schema consistency.

### SDD (Spec Driven) ✅
- [x] Spec: JSON-LD based manifest structure.
- [x] Spec: Capability request definitions (factors).
- [x] Spec: WIT interface mappings for WASM plugins.

### BDD (Behaviour Driven) ✅
- [x] Integration: Valid manifest correctly identified by `Registry`.
- [x] Integration: Capability mismatches correctly rejected.
- [x] Integration: Multi-runtime types (Browser, Node.js, Workers) defined.

### TDD (Test Driven) ✅
- [x] Unit: Manifest validation against JSON schema.
- [x] Unit: Fixture-based tests for correct and incorrect manifests.
- [x] Coverage: >90% (Contract Critical)

### DDD (Domain Implementation) ✅
- [x] Domain: Core `PluginManifest` validation logic.
- [x] Infra: TypeScript library distribution.

---

## v0.2.0 - Capability-Gating & Multi-Runtime
**Scope**: Formalizing host capability negotiation and runtime support.

- [ ] Implementation of **Runtime Specification**: Explicit support for `main`, `worker`, `service-worker`, and `edge` execution contexts.
- [ ] **Dependency Matching**: Ensuring plugin manifests correctly specify `refarm` engine version and contract dependencies.

---

## v0.3.0 - Dynamic Negotiation
**Scope**: Enabling runtime negotiation of optional capabilities.

- [ ] Implementation of **Optional Factors**: Standardizing how a manifest requests optional host capabilities (e.g. `notification-api`).
- [ ] **Interactive Manifests**: Supporting progressive disclosure of required capabilities.

---

## Notes
- See [packages/plugin-manifest/src/types.js](./src/types.js) for core structure.
- The "Digital Deed" for every Refarm plugin.
