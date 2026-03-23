# Spin Synergy - Roadmap

**Current Version**: v0.1.0 (Tractor Native Graduated)  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../../docs/WORKFLOW.md))

---

## v0.1.0 - Architectural Alignment (DONE)
**Scope**: Study Spin v3 Factors and cross-language dependencies.  
**Gate**: `docs/research/spin-synergy.md` completed.

---

## v0.2.0 - Factorized Runtime
**Scope**: Refactoring `tractor` host into modular "Factors" (Capabilities).  
**Depends on**: `wasmtime` component-model stability.

### SDD (Spec Driven)
- [ ] ADR-XXX: `tractor` Factored Host Architecture.
- [ ] Spec: Factor interface for `wasi:key-value`, `wasi:http`, and `refarm:storage`.
- [ ] Spec: Factor registration and discovery in the host runtime.

### BDD (Behaviour Driven)
- [ ] Integration: Enable/Disable specific host capabilities via config.
- [ ] Integration: Mock entire "Factors" for plugin unit testing.
- [ ] Acceptance: Plugin invocation of a remote Factor (e.g., AI Host).

### TDD (Test Driven)
- [ ] Unit: `FactorManager` tests.
- [ ] Unit: Individual Factor isolation tests.
- [ ] Coverage: ≥80%

### DDD (Domain Implementation)
- [ ] Domain: Core `tractor` host refactor.
- [ ] Infra: `StorageFactor`, `HttpFactor`, `CryptoFactor`.
- [ ] Infra: `spin build` / `spin up` logic adaptation for local execution.

---

## v0.3.0 - Component Composition
**Scope**: Enabling plugins to depend on and invoke other plugins (Component-to-Component).

- [ ] Implementation of **Runtime Linking**: Dynamically resolve and link WASM components at startup.
- [ ] Support for **Native Multi-language Plugins**: Directly invoking Python/JS components from Rust host without IPC overhead (using the Component Model).

---

## Notes
- Based on [Research: Spin v3 Synergy Analysis](../docs/research/spin-synergy.md).
- Follow the [Bytecode Alliance](https://bytecodealliance.org) standards for WIT and WASI.
