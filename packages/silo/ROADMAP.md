# Silo (Secrets & Identity) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

> **Revision 2026-06-29.** Silo has not published yet, so the v0.1.0 momentum is used to land the
> full consumer-facing surface in one push (v0.1.1) and **freeze the consumer API contract**. The
> security milestones (v0.2.0 OPAQUE, v0.3.0 Sentinel) then evolve *internals behind the frozen
> surface* — adopting consumers (vault-seed item 8a and the next consumer) ride the security
> improvements without churn. Goal: ship Silo consumer-complete and not reshape it for a long while.

---

## v0.1.0 - Provisioning Foundation (DONE)
**Scope**: Establish the core context provisioner and master key bootstrapping.  
**Depends on**: `@refarm.dev/heartwood` for JS/WASM key operations.

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

## v0.1.1 - Consumer Surface Completion (PRE-LAUNCH)
**Scope**: Close the gaps the first external consumer (`vault-seed`, item 8a) hit, so the public
surface ships complete and stable. Every item below is backed by the 2026-06-29 consumer proof in
`specs/features/2026-06-26-vault-seed-silo-bridge.md` (Consumer Findings).

### Storage / identity closure split — **ADR-076**
- [ ] `.` export (`SiloCore` storage) free of a static `key-manager.js` import; `bootstrapIdentity`
  loads `KeyManager` dynamically (matching how `key-manager.js` already defers `heartwood`).
- [ ] `@refarm.dev/heartwood` becomes an `optionalDependency` (or optional peer), required only by
  the `./key-manager` identity surface. A `channel`/`publishing` consumer installs without the WASM
  closure — "light by default".
- [ ] Test: importing `@refarm.dev/silo` + `saveSecret`/`loadSecret` never resolves `heartwood`.

### Namespaced bulk operations
- [ ] `listSecrets(namespace): Promise<Record<id, value>>` — enumerate a namespace (consumer status
  views need it; no single-key form exists today).
- [ ] `removeSecret(namespace, id)` — delete one secret; consumers compose service-level removal.
- [ ] Tests: enumeration scoped to one namespace; two namespaces never collide.

### Storage hardening (security now, before OPAQUE)
- [ ] Write the secret file `0600` and its directory `0700`, with a Windows/no-POSIX no-op guard.
- [ ] Test: file lands `0600` on POSIX.

### Collection contract — multi-field services
- [ ] Resolve the single-value `collect(ctx): Promise<string>` vs multi-field services (telegram =
  `BOT_TOKEN` + `CHAT_ID`): document **provider-per-key** (namespace `channel`, `id` = env key,
  composes with `listSecrets`) as the supported shape, or extend to a credential-set collect.
- [ ] Keep per-field masking and discovery flows as downstream UX.

### Storage location & legacy import
- [ ] Document `config.storagePath` as the supported home override (default
  `resolveSiloHome()/identity.json`); confirm `SILO_HOME`/`REFARM_HOME` precedence.
- [ ] Document non-destructive legacy import (read fallback); no automatic deletion of prior stores.

### Env hydration (candidate)
- [ ] Decide whether a namespace-scoped, non-overriding `process.env` hydrate helper lives in Silo
  or stays downstream. Consumer hot path is `injectSiloEnv()`; `resolve()→Map` covers provider
  tokens only. Flagged as a candidate, not a blocker.

---

## API Stability Contract (frozen at v0.1.1)

After v0.1.1, the **consumer-facing surface is stable** and later milestones must not break it:

- **Storage:** `saveSecret`, `loadSecret`, `listSecrets`, `removeSecret`, `saveTokens`, `loadTokens`.
- **Collection:** `CredentialProvider`, `CollectContext`, `collectAndStore`, the reserved namespace
  set (`model | runtime | channel | publishing`, consumer-extensible).
- **Provisioning:** `resolve`, `provision`, `toGitHubEnv`.
- **Home/location:** `resolveSiloHome`, `config.storagePath`.

v0.2.0 and v0.3.0 change **how** secrets are protected at rest and where keys live — **not** these
signatures. Encryption and isolation are internal; a consumer that adopted v0.1.1 gains them by
upgrading, without code changes.

---

## v0.2.0 - OPAQUE Protection (internal; surface frozen)
**Scope**: Protecting the Silo master key and tokens with the OPAQUE protocol — **behind the frozen
v0.1.1 storage surface**, no consumer API change. *Consumer demand affirmed (vault-seed, 2026-06-29):
the at-rest encryption our users deserve; prioritization signal, not new scope.*

- [ ] Implementation of **OPAQUE Key Stretching**: Replace standard hashing with OPAQUE OPRF for unlocking the Vault.
- [ ] **Identity Derived Keys**: Using the OPAQUE session key to encrypt/decrypt sensitive identity artifacts.
- [ ] At-rest encryption of namespaced secrets written via `saveSecret` (transparent to consumers).
- [ ] Strategic alignment with `packages/tractor/docs/OPAQUE.md`.

---

## v0.3.0 - Sentinel Isolation (internal; surface frozen)
**Scope**: Moving the Silo's sensitive core into a hardware/WASM-isolated context — **behind the
frozen v0.1.1 surface**, no consumer API change. *Consumer demand affirmed (vault-seed, 2026-06-29).*

- [ ] Implementation of **Sentinel WASM**: Running the Silo's key management in an isolated `wasmtime` context with exclusive access to the `server_key`.
- [ ] Support for **TPM/HSM** backends for the master key.

---

## Notes
- See [packages/silo/src/index.js](./src/index.js) for core logic.
- The "Vault" of the sovereign citizen — preserving the keys to the farm.
- Consumer evidence: `specs/features/2026-06-26-vault-seed-silo-bridge.md` (Consumer Findings,
  2026-06-29) and `specs/ADRs/ADR-076-silo-storage-identity-closure-separation.md`.
