# Fence (Security Sandboxing) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Pure Microkernel Boundary (DONE/In Progress)
**Scope**: Establish the core sandboxing contracts for WASM plugins.  
**Gate**: Verified WIT boundary and basic capability isolation.

### SDD (Spec Driven) ✅
- [x] Spec: `refarm:plugin/tractor-bridge` security constraints.
- [x] Spec: Default "Closed-by-Default" capability posture.

### BDD (Behaviour Driven) ✅
- [x] Integration: Plugins correctly rejected if requesting unauthorized factors.
- [x] Integration: Resource limits enforced at the boundary.

### TDD (Test Driven) ✅
- [x] Unit: Capability negotiation logic.
- [x] Coverage: >90% (Security Critical)

### DDD (Domain Implementation) ✅
- [x] Domain: Core `fence` boundary logic.
- [x] Infra: WASM runtime integration.

---

## v0.2.0 - Formal Sandboxing Architecture
**Scope**: Advanced isolation techniques and multi-layer defense.

- [ ] Implementation of **Namespace Isolation**: Scoping storage and network access to plugin-specific namespaces.
- [ ] **Sentinel Integration**: Working with [ADR-032](../../specs/ADRs/ADR-032-recovery-service.md) for high-assurance isolation.

---

## v0.3.0 - Runtime Behavioral Analysis
**Scope**: Real-time monitoring and threat detection for active plugins.

- [ ] Implementation of **Pulse Monitoring**: Analyzing plugin behavior via `Creek` to detect anomalies.
- [ ] **Dynamic Quarantine**: Automatically revoking capabilities from misbehaving plugins.

---

## Notes
- See [packages/fence/src/index.js](./src/index.js) for core structure.
- The "Hardened Perimeter" of the sovereign farm — ensuring no pest can enter the microkernel.
