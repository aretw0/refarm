# Sower & Thresher (Seed & Harvest) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - ETL Foundation (DONE/In Progress)
**Scope**: Establish the core ingestion (Sower) and extraction (Thresher) primitives.  
**Gate**: Verified JSON/CSV seeding and basic SQLite-to-JSON harvesting.

### SDD (Spec Driven) ✅
- [x] Spec: `Sower` core interface (Node.js/Browser).
- [x] Spec: `Thresher` extractor logic.
- [x] Spec: Incremental seeding contract.

### BDD (Behaviour Driven) ✅
- [x] Integration: Seed a Sovereign Graph node from a JSON file via `Sower`.
- [x] Integration: Harvest a specific subgraph as a JSON-LD bundle via `Thresher`.
- [x] Integration: Correct deduplication of nodes on re-seeding.

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
- [ ] **Scheduled Harvesting**: Triggering `Thresher` jobs automatically based on `Windmill` workflows.

---

## Notes
- See [packages/sower/src/core.ts](./src/core.ts) for core logic.
- The "Seed" and "Harvest" of the sovereign farm — maintaining the seasonal flow of data.
