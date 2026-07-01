# ADR-076: Silo Storage Surface Free of the Identity Closure

**Status**: Proposed
**Date**: 2026-06-29
**Authors**: Arthur Silva, Claude
**Related**: ADR-072 (Consumer Leaf Distribution Policy), ADR-064 (Credential Error Enrichment),
`specs/features/2026-06-26-vault-seed-silo-bridge.md`, `packages/silo/ROADMAP.md`,
`docs/decision-log.md`

---

## Context

`@refarm.dev/silo` is the upstream secret provisioner. `vault-seed` is its first external
`channel`/`publishing` consumer (convergence item 8a). The 2026-06-29 consumer proof verified the
package's runtime and install closures against what a storage-only consumer actually needs.

Findings (verified against `packages/silo/dist`):

- **Runtime closure is already lean.** `KeyManager` loads `@refarm.dev/heartwood` through a dynamic
  `await import(...)` inside `generateMasterKey`/`sign`, with the explicit comment *"to avoid
  premature WASM loading"*. A consumer that only calls `saveSecret`/`loadSecret` never loads the
  WASM. This is correct and should be preserved.
- **Install closure is not lean.** `dist/index.js` statically imports `KeyManager` from
  `./key-manager.js`, and `@refarm.dev/heartwood` is a hard `dependency` (`workspace:*`). So a
  `channel`-only consumer still pulls `heartwood` into its install/download closure even though it
  never executes any identity/sign path. `saveSecret`/`loadSecret` are plain JSON file operations
  with no cryptographic dependency.

This is the same concern ADR-072 settled for distribution: a light surface should not inherit a
heavier domain's closure. ADR-072 reasoned about *package* boundaries; this ADR applies the same
rule *inside* `silo` — between its storage surface and its identity surface.

A second, narrower finding: `silo` storage performs no filesystem-permission hardening
(`_ensureStorage` is `mkdirSync(dir, { recursive: true })`; `writeFileSync` uses no `mode`; no
`chmod` exists anywhere in the package). The `vault-seed` reimplementation it replaces writes
`0600`/`0700` with a Windows no-op guard. Permission hardening is storage's responsibility **now**
and is distinct from the at-rest encryption planned for v0.2.0 (OPAQUE).

## Decision

`silo`'s storage surface (`saveSecret`, `loadSecret`, `saveTokens`, `loadTokens`, and any future
`listSecrets`/`removeSecret`) must be importable without pulling the identity/`heartwood` install
closure.

1. **Identity stays behind its subpath.** `KeyManager` and its `heartwood` use remain on the
   published `./key-manager` subpath. The base `.` export (`SiloCore` storage) must not statically
   import `key-manager.js`; `bootstrapIdentity` (already `async`) loads it dynamically, matching how
   `key-manager.js` already defers `heartwood`.
2. **`heartwood` is optional to storage.** `@refarm.dev/heartwood` becomes an `optionalDependency`
   (or an optional peer) required only by the identity surface. A storage-only consumer installs
   `silo` without the WASM closure; a consumer that uses identity installs `heartwood` too.
3. **Storage hardens permissions now.** Storage writes the secret file with `0600` and its directory
   with `0700`, guarded as a no-op on platforms without POSIX modes, independent of and ahead of the
   v0.2.0 OPAQUE at-rest encryption.

## Consequences

### Positive

- A `channel`/`publishing` consumer (vault-seed item 8a) adopts `silo` storage without inheriting
  the identity/WASM install closure — "light by default".
- The identity/security roadmap (v0.2.0 OPAQUE, v0.3.0 Sentinel) can grow heavier without taxing
  storage-only consumers.
- Secrets at rest gain `0600` hardening immediately, narrowing the gap until OPAQUE lands.

### Negative / Risks

- Splitting the install closure may require `heartwood` callers to opt in explicitly; identity
  consumers must declare or rely on the optional dependency resolving. Mitigation: the `./key-manager`
  subpath is the single documented identity entry point.
- An `optionalDependency` that fails to install would surface only when identity is used. Mitigation:
  identity methods already `await import` and can raise a clear "install @refarm.dev/heartwood" error.

## Implementation

1. Make `dist/index.js` (`.` export) free of a static `key-manager.js` import; `bootstrapIdentity`
   dynamically imports `KeyManager`.
2. Move `@refarm.dev/heartwood` to `optionalDependencies` (or optional peer); keep it required by the
   `./key-manager` surface and document it there.
3. Add `0600`/`0700` mode hardening to storage writes with a Windows/no-POSIX no-op guard.
4. Cover with a test that importing `@refarm.dev/silo` and calling `saveSecret`/`loadSecret` does not
   resolve `@refarm.dev/heartwood`, and that the secret file lands `0600` on POSIX.
