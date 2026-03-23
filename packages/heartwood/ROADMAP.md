# Heartwood (Security Kernel) - Roadmap

**Current Version**: v0.1.0-dev (WASM/JCO stable)  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Cryptographic Foundation (DONE)
**Scope**: Establish the core WASM-based cryptographic primitives.  
**Gate**: Pre-compiled JCO artifacts in `pkg/` and verified Ed25519/SHA-256 logic.

### SDD (Spec Driven) ✅
- [x] Spec: `refarm:plugin/heartwood` WIT interface.
- [x] Spec: WASM Component Model + JCO transpilation architecture.
- [x] Spec: Ed25519 signing and verification contract.
- [x] Spec: SHA-256 hashing contract.

### BDD (Behaviour Driven) ✅
- [x] Integration: Ed25519 signature roundtrip (Sign → Verify).
- [x] Integration: JCO-transpiled module usable in Node.js and Browser.
- [x] Integration: SHA-256 consistency with `@noble/hashes` test vectors.

### TDD (Test Driven) ✅
- [x] Unit: Ed25519 native Rust vs JS parity.
- [x] Unit: Key derivation logic.
- [x] Coverage: >95% (Security Critical)

### DDD (Domain Implementation) ✅
- [x] Domain: Core Rust crate `heartwood`.
- [x] Infra: JCO transpile pipeline and `pkg/` distribution.

---

## v0.2.0 - Native Tractor Integration
**Scope**: Deep integration with the native `tractor` execution engine.

- [ ] Implementation of **Native Security Mode**: Direct invocation of Heartwood primitives from `tractor` (Rust) without WASM overhead.
- [ ] **Capability-Gated Access**: Enforcing that only authorized plugins can invoke specific cryptographic functions (e.g. `sign-event`).

---

## v0.3.0 - Hardware-Backed Primitives
**Scope**: Bridging sovereign keys to hardware security modules (HSM/TPM).

- [ ] Implementation of **Hardware Provider WIT**: Standardizing how Heartwood requests signatures from a TPM or Secure Enclave.
- [ ] Support for **WebAuthn/Passkey** as a Heartwood entropy source.

---

## Notes
- See [packages/heartwood/README.md](./README.md) for usage.
- High-level architecture: [`docs/WASM_JCO_ARCHITECTURE.md`](../../docs/WASM_JCO_ARCHITECTURE.md).
