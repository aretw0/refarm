# Sower & Thresher - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Import/Export Foundation (DONE/In Progress)
**Scope**: Establish the core ingestion (Sower) and extraction (Thresher) primitives.  
**Gate**: Verified JSON/CSV import and basic SQLite-to-JSON export.

### SDD (Spec Driven) ✅
- [x] Spec: `Sower` core interface (Node.js/Browser).
- [x] Spec: `Thresher` extractor logic.
- [x] Spec: Incremental import contract.

### BDD (Behaviour Driven) ✅
- [x] Integration: Import a graph node from a JSON file via `Sower`.
- [x] Integration: Export a specific subgraph as a JSON-LD bundle via `Thresher`.
- [x] Integration: Correct deduplication of nodes on repeated import.

### TDD (Test Driven) ✅
- [x] Unit: `Sower` node mapping logic and validation.
- [x] Unit: `Thresher` extraction performance for >10,000 nodes.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `Sower` and `Thresher` logic.
- [x] Infra: Node.js and Browser-specific adapters.

---

## v0.2.0 - Transformation Logic
**Scope**: Enabling data transformation and schema mapping during the ETL cycle.

- [ ] Implementation of **Transform Pipelines**: Standardizing how a developer can map external schemas (e.g. RSS, Matrix, Nostr) to Refarm's JSON-LD core.
- [ ] **Validation Hooks**: Running `scarecrow` or `plugin-manifest` validation as part of the ingestion pipeline.

---

## v0.3.0 - Graph-Native ETL
**Scope**: Running the ETL process as an autonomous plugin within the microkernel.

- [ ] Implementation of **WASM-based Importers**: Developing importers for popular data sources that run directly in the `tractor` sandbox.
- [ ] **Scheduled Export**: Triggering `Thresher` jobs automatically based on `Windmill` workflows.

---

## Notes
- See [packages/sower/src/core.ts](./src/core.ts) for core logic.
- Sower owns public workspace scaffolding and import flows; Thresher owns export flows.
