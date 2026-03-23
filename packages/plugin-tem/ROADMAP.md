# Plugin-TEM (AI Reasoning) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Reasoning Core (In Progress)
**Scope**: Establish the core TEM reasoning engine in WASM/Worker.  
**Depends on**: `tractor` (Plugin runtime), `storage-sqlite`

### SDD (Spec Driven) ✅
- [x] Spec: TEM-based graph reasoning architecture (TEM_insight.md).
- [x] Spec: WIT interface for temporal/spatial reasoning.
- [x] Spec: `PluginTEM` core structure.

### BDD (Behaviour Driven) 🚧
- [ ] Integration: `TEM` correctly predicts node co-occurrence in a test graph.
- [ ] Integration: Novelty detection signals emitted correctly.
- [ ] Integration: Worker-based execution isolated from main thread.

### TDD (Test Driven) 🔄
- [ ] Unit: TEM core logic (Relational topology training).
- [ ] Unit: Encoding/Decoding of TEM state to the graph.
- [ ] Coverage: >75%

### DDD (Domain Implementation) 🔄
- [ ] Domain: Core `TEM` Rust/WASM engine.
- [ ] Infra: `plugin-tem` worker-based proxy.
- [ ] Infra: Integration with `Surveyor` for graph traversal.

---

## v0.2.0 - Sovereign Graph Autonomy
**Scope**: Enabling TEM to autonomously navigate and organize the user's graph.

- [ ] Implementation of **Autonomous Map Building**: TEM builds a structural representation of the Sovereign Graph over time.
- [ ] **Proactive Discovery**: Suggesting connections or identifying "forgotten" nodes based on learned topology.

---

## v0.3.0 - Kernel-Level Intelligence
**Scope**: Integrating TEM intelligence directly into the Refarm execution engine.

- [ ] Implementation of **Telemetry Intelligence**: Analyzing `Creek` events in real-time to detect anomalous system patterns.
- [ ] **Graph-Native Inference**: Exposing TEM reasoning as a first-class primitive to all other plugins.

---

## Notes
- Based on [Research: TEM Sovereign Graph Design](../../docs/research/tem-sovereign-graph-design.md).
- The "Brain" of the sovereign farm — learning the pathways of the digital soil.
