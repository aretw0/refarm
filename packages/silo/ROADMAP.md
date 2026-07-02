# Silo (Secrets & Identity) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

> **Revision 2026-06-30.** Silo has not published yet, so the first public `0.1.0` should already
> include the full consumer-facing surface, storage/identity closure split, and protection envelope.
> Do not treat the pre-publication hardening as `0.1.1`; fold it into the initial release. The
> security milestones (OPAQUE and hardware-backed isolation) then evolve *internals behind the frozen
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

## v0.1.0 - Consumer Surface Completion (PRE-LAUNCH)
**Scope**: Close the gaps the first external consumer (`vault-seed`, item 8a) hit, so the public
surface ships complete and stable. Every item below is backed by the 2026-06-29 consumer proof in
`specs/features/2026-06-26-vault-seed-silo-bridge.md` (Consumer Findings).

### Storage / identity closure split — **ADR-076**
- [x] `.` export (`SiloCore` storage) free of a static `key-manager.js` import; `bootstrapIdentity`
  loads `KeyManager` dynamically (matching how `key-manager.js` already defers `heartwood`).
- [x] `@refarm.dev/heartwood` becomes an `optionalDependency` (or optional peer), required only by
  the `./key-manager` identity surface. A `channel`/`publishing` consumer installs without the WASM
  closure — "light by default".
- [x] Test: importing `@refarm.dev/silo` + `saveSecret`/`loadSecret` never resolves `heartwood`.

### Namespaced bulk operations
- [x] `listSecrets(namespace): Promise<Record<id, value>>` — enumerate a namespace (consumer status
  views need it; no single-key form exists today).
- [x] `removeSecret(namespace, id)` — delete one secret; consumers compose service-level removal.
- [x] Tests: enumeration scoped to one namespace; two namespaces never collide.

### Storage hardening (security now, before OPAQUE)
- [x] Write the secret file `0600` and its directory `0700`, with a Windows/no-POSIX no-op guard.
- [x] Test: file lands `0600` on POSIX.

### Protection envelope — **ADR-077**
- [x] Store namespaced secrets as versioned envelopes with explicit protection metadata rather than
  bare strings.
- [x] Keep consumer methods string-based (`saveSecret`, `loadSecret`, `listSecrets`) while reading
  legacy plaintext entries.
- [x] Expose `describeProtection()` so hosts can report current protection and planned upgrade path
  without loading Heartwood.
- [x] Mark the current scheme honestly as `local-plaintext-v1` with owner-only file modes, with
  `opaque-envelope-v1` and hardware-backed envelopes as planned internal upgrades.
- [x] Forward-safe reads: an unreadable envelope (`encrypted: true` / unknown scheme) makes
  `loadSecret` throw `UnreadableSecretError` (`SILO_SECRET_UNREADABLE`) and `listSecrets` omit it —
  never returns ciphertext as plaintext. Ships in the first public `0.1.0` so consumers are
  forward-safe by construction (vault-seed consumer proof, 2026-06-29).

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

## API Stability Contract (frozen at v0.1.0)

At the first public `0.1.0`, the **consumer-facing surface is stable** and later milestones must not
break it:

- **Storage:** `saveSecret`, `loadSecret`, `listSecrets`, `removeSecret`, `saveTokens`, `loadTokens`.
- **Protection status:** `describeProtection`, `SILO_STORE_SCHEMA_VERSION`,
  `SILO_SECRET_PROTECTION_SCHEME`.
- **Collection:** `CredentialProvider`, `CollectContext`, `collectAndStore`, the reserved namespace
  set (`model | runtime | channel | publishing`, consumer-extensible).
- **Provisioning:** `resolve`, `provision`, `toGitHubEnv`.
- **Home/location:** `resolveSiloHome`, `config.storagePath`.

Future OPAQUE and hardware-backed work changes **how** secrets are protected at rest and where keys
live — **not** these signatures. Encryption and isolation are internal; a consumer that adopted the
first public Silo gains them by upgrading, without code changes.

---

## Post-0.1 - OPAQUE Protection (internal; surface frozen)
**Scope**: Protecting the Silo master key and tokens with the OPAQUE protocol — **behind the frozen
first-public storage surface**, no consumer API change. *Consumer demand affirmed (vault-seed,
2026-06-29): the at-rest encryption our users deserve; prioritization signal, not new scope.*

- [ ] Implementation of **OPAQUE Key Stretching**: Replace standard hashing with OPAQUE OPRF for unlocking the Vault.
- [ ] **Identity Derived Keys**: Using the OPAQUE session key to encrypt/decrypt sensitive identity artifacts.
- [ ] At-rest encryption of namespaced secrets written via `saveSecret` (transparent to consumers).
- [ ] Strategic alignment with `packages/tractor/docs/OPAQUE.md`.

---

## Post-0.1 - Sentinel Isolation (internal; surface frozen)
**Scope**: Moving the Silo's sensitive core into a hardware/WASM-isolated context — **behind the
frozen first-public surface**, no consumer API change. *Consumer demand affirmed (vault-seed,
2026-06-29).*

- [ ] Implementation of **Sentinel WASM**: Running the Silo's key management in an isolated `wasmtime` context with exclusive access to the `server_key`.
- [ ] Support for **TPM/HSM** backends for the master key.

---

## Notes
- See [packages/silo/src/index.js](./src/index.js) for core logic.
- The "Vault" of the sovereign citizen — preserving the keys to the farm.
- Consumer evidence: `specs/features/2026-06-26-vault-seed-silo-bridge.md` (Consumer Findings,
  2026-06-29) and `specs/ADRs/ADR-076-silo-storage-identity-closure-separation.md`.
