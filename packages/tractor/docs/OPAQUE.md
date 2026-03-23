# OPAQUE aPAKE - Roadmap

**Current Version**: v0.1.0-dev (WIT defined)  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../../docs/WORKFLOW.md))

---

## v0.1.0 - Identity Contract (DONE)
**Scope**: Stabilize the WIT interfaces for identity providers.  
**Gate**: `world refarm-identity-plugin` and `interface identity-provider` in `wit/refarm-sdk.wit`.

---

## v0.2.0 - Adapter Implementation
**Scope**: First functional OPAQUE-based identity adapter.  
**Depends on**: `tractor` (Rust host), RFC-9497 (OPRF) stability.

### SDD (Spec Driven)
- [ ] ADR-XXX: OPAQUE Key Exchange integration in `tractor`.
- [ ] Spec: `identity-opaque-v1` plugin WIT bindings.
- [ ] Spec: Server-side (refarm.social) registration/auth endpoints.

### BDD (Behaviour Driven)
- [ ] Integration: 1-Day Spike in `tractor` (cargo test -- opaque_spike).
- [ ] Integration: Client registration with OPRF blinding.
- [ ] Integration: Authentication without password leakage to server.

### TDD (Test Driven)
- [ ] Unit: `opaque-ke` Rust wrapper tests.
- [ ] Unit: Session key derivation from OPAQUE output.
- [ ] Coverage: ≥90% (Security Critical)

### DDD (Domain Implementation)
- [ ] Domain: `tractor` integration logic for `opaque-ke`.
- [ ] Infra: `identity-opaque-v1` adapter implementation.
- [ ] Infra: Test vectors for cross-language validation (JS↔Rust).

---

## v0.3.0 - Recovery & Sentinel
**Scope**: Using OPAQUE for secure recovery and high-trust key protection.

- [ ] Implementation of **Recovery Service** (ADR-032) using OPAQUE as the primary auth mechanism for recovery relays.
- [ ] **Sentinel WASM** integration: Protecting the OPAQUE server key in an isolated, secure execution context.

---

## Notes
- Based on [Research: OPAQUE Strategic Assessment](../docs/research/opaque-apake-strategic-assessment.md).
- Track the RFC: [draft-irtf-cfrg-opaque](https://datatracker.ietf.org/doc/draft-irtf-cfrg-opaque/).
