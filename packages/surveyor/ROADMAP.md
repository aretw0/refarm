# Surveyor (O Agrimensor) - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Graph Mapping Foundation
**Scope**: Establish the core mapping of nodes from SQLite to a navigable graph structure.  
**Depends on**: `tractor` (Storage access), `storage-sqlite`

### SDD (Spec Driven)
- [ ] Spec: `refarm-surveyor.wit` interface stabilization.
- [ ] Spec: JSON-LD Graph traversal logic (edges, connections).
- [ ] Spec: General graph statistics definitions (node count, edge count).

### BDD (Behaviour Driven)
- [ ] Integration: `Surveyor` correctly maps 10,000+ nodes under 50ms.
- [ ] Integration: Node connections correctly resolved via `node-id`.
- [ ] Integration: Data provider supplies graph structure to Studio.

### TDD (Test Driven)
- [ ] Unit: Connection resolution and edge parsing.
- [ ] Unit: Type-based querying logic (e.g., fetch all `Person` nodes).
- [ ] Coverage: ≥80%

### DDD (Domain Implementation)
- [ ] Domain: `Surveyor` core mapping engine.
- [ ] Infra: Integration with `Tractor`'s native storage calls.
- [ ] Infra: Studio graph provider implementation.

---

## v0.2.0 - Semantic Discovery & Viz
**Scope**: Advanced graph navigation and 2D/3D visualization providers.

- [ ] Implementation of **Complex Semantic Queries**: Mult-hop traversals and ontology-based filtering.
- [ ] **Visualization Drivers**: Providing optimized data structures for 2D (D3/Force-directed) and 3D (Three.js) graph views.
- [ ] Dynamic mapping of plugin-specific data structures as sub-graphs.

---

## Notes
- See [packages/surveyor/README.md](./README.md) for initial WIT draft.
- Central component for making the Sovereign Graph "navigable" by both humans and agents.
