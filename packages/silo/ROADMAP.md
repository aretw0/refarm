# Silo (Secrets & Identity) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Provisioning Foundation (DONE)
**Scope**: Establish the core context provisioner and master key bootstrapping.  
**Depends on**: `ed25519-dalek` (Rust) / `@noble/ed25519` (JS)

### SDD (Spec Driven) ✅
- [x] Spec: `SiloCore` context and secret provisioner.
- [x] Spec: Token resolution (Environment → Persisted → Remote).
- [x] Spec: GitHub Actions environment provisioning (`toGitHubEnv`).

### BDD (Behaviour Driven) ✅
- [x] Integration: Provision tokens for specific targets.
- [x] Integration: Bootstrap identity metadata.
- [x] Integration: Save/Load tokens from persistent storage (`identity.json`).

### TDD (Test Driven) ✅
- [x] Unit: `KeyManager` master key generation.
- [x] Unit: Token merging and priority resolution.
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `SiloCore` logic.
- [x] Infra: Node.js file system persistence.

---

## v0.2.0 - OPAQUE Protection
**Scope**: Protecting the Silo master key and tokens with the OPAQUE protocol.

- [ ] Implementation of **OPAQUE Key Stretching**: Replace standard hashing with OPAQUE OPRF for unlocking the Vault.
- [ ] **Identity Derived Keys**: Using the OPAQUE session key to encrypt/decrypt sensitive identity artifacts.
- [ ] Strategic alignment with `packages/tractor/docs/OPAQUE.md`.

---

## v0.3.0 - Sentinel Isolation
**Scope**: Moving the Silo's sensitive core into a hardware/WASM-isolated context.

- [ ] Implementation of **Sentinel WASM**: Running the Silo's key management in an isolated `wasmtime` context with exclusive access to the `server_key`.
- [ ] Support for **TPM/HSM** backends for the master key.

---

## Notes
- See [packages/silo/src/index.js](./src/index.js) for core logic.
- The "Vault" of the sovereign citizen — preserving the keys to the farm.
