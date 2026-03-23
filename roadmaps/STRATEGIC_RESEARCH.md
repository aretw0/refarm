# Strategic Research - Roadmap

**Focus**: Bridging the gap between theory (Research) and execution (Implementation).  
**Parent**: [Main Roadmap](../roadmaps/MAIN.md)  
**Archives**: [Research Index](../docs/research/INDEX.md)

---

## 1. Security & Identity (OPAQUE / aPAKE)
**Status**: 🚧 Research Completed → Integration Planned  
**Reference**: [OPAQUE/aPAKE Strategic Assessment](../docs/research/opaque-apake-strategic-assessment.md)

### Next Steps:
- [ ] Integration into the **Heartwood (v0.2.0)** security kernel.
- [ ] Transitioning from temporary mnemonic-based identity to OPAQUE-based "Memory Password" identity.
- [ ] Designing the **Silo (v0.2.0)** vault upgrade path to support aPAKE registration.

---

## 2. Infrastructure & Synergy (Spin / WASM)
**Status**: 🚧 Research Completed → Integration Planned  
**Reference**: [Spin Framework Synergy](../docs/research/spin-synergy.md)

### Next Steps:
- [ ] Evaluating **Spin v3 Component Model** for the **Tractor (Rust)** host.
- [ ] Defining the **Tractor (v0.2.0)** edge deployment strategy based on Spin triggers.
- [ ] Aligning the **Toolbox** scaffolding with Spin-compatible component architectures.

---

## 3. Structural Intelligence (TEM)
**Status**: 🚧 Research Active → Implementation In Progress  
**Reference**: [TEM Sovereign Graph Design](../docs/research/tem-sovereign-graph-design.md)

### Next Steps:
- [ ] Refining the **Plugin-TEM (v0.1.0)** core reasoning engine in WASM.
- [ ] Prototyping **Surveyor** integration for visual representation of TEM-detected clusters.
- [ ] Implementing **Windmill Smart Intents** based on TEM novelty detection.

---

## 4. Graph-Native Publishing (Antenna)
**Status**: 🚧 Research Completed → Integration Planned  
**Reference**: [Graph-Native Publishing Analysis](../docs/research/graph-native-publishing.md)

### Next Steps:
- [ ] Standardizing the **Plugin-Courier (v0.2.0)** materialization templates.
- [ ] Designing **Sovereign SEO** (JSON-LD nodes as first-class search signals).
- [ ] Exploring decentralized discovery for published nodes (Nostr NIP extensions).

---

## Roadmap Interlocks
- **Heartwood** ↔ **OPAQUE** (Security)
- **Tractor** ↔ **Spin** (Runtime)
- **TEM** ↔ **Surveyor** (Intelligence)
- **Courier** ↔ **Graph Publishing** (Broadcast)

---

## Notes
- This document ensures that architectural research is never lost and always has a clear path to becoming a feature.
- Follows the [AGENTS.md](../AGENTS.md) rule for "Documentation Continuity".
