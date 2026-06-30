# ADR-077: Silo Protected Secret Envelope

**Status**: Accepted
**Date**: 2026-06-30
**Authors**: Arthur Silva, Codex
**Related**: ADR-075 (Pears as Distributed Runtime Reference), ADR-076 (Silo Storage Surface Free of
the Identity Closure), `packages/silo/ROADMAP.md`, `packages/heartwood/ROADMAP.md`

---

## Context

Silo is the shared credential and secret provisioner for Refarm, `vault-seed`, and future consumers.
ADR-076 made the storage surface light by default: a channel/publishing consumer can install and use
Silo without pulling the Heartwood identity/WASM closure.

That split is correct, but it creates a second risk: if Silo publishes `0.1.0` with bare plaintext
secret entries, downstream consumers may grow around the on-disk shape before OPAQUE, passkeys, TPM,
or P2P replication are ready. Pears is a useful reference here because its platform shape separates
runtime/storage/distribution layers while preserving a path to signed, capability-keyed, replicated
artifacts. Refarm needs the same posture: do not claim encryption before it exists, but do not let
the public Silo storage contract be a dead end.

## Decision

Silo owns the protected secret envelope for its storage domain. Heartwood owns cryptographic
primitives. A separate `secret-envelope-contract-v1` package is deferred until a second package or
consumer needs to read/write Silo envelopes directly.

The first public Silo release must store namespaced secrets in a versioned envelope:

```json
{
  "schemaVersion": 1,
  "secrets": {
    "publishing": {
      "TELEGRAM_BOT_TOKEN": {
        "value": "...",
        "protection": {
          "scheme": "local-plaintext-v1",
          "encrypted": false,
          "atRest": "posix-owner-only",
          "keySource": "none",
          "upgradeTarget": "opaque-envelope-v1"
        }
      }
    }
  }
}
```

Consumer methods remain string-based:

- `saveSecret(namespace, id, value)`
- `loadSecret(namespace, id)`
- `listSecrets(namespace)`
- `removeSecret(namespace, id)`

Silo exposes `describeProtection()` so hosts and downstream adapters can report current protection
without inspecting private JSON or loading Heartwood. Today it reports `local-plaintext-v1` plus
owner-only file modes. Future OPAQUE and hardware-backed work changes the envelope internals, not
the consumer method signatures.

**Forward-safe reads (the scheme is executable, not decorative).** A build must not return the raw
stored value for an envelope it cannot interpret. If a reader meets `encrypted: true` or an unknown
`protection.scheme`, `loadSecret` throws a typed `UnreadableSecretError`
(`code: "SILO_SECRET_UNREADABLE"`, `scheme`) and `listSecrets` omits that entry while keeping
readable siblings. Legacy plaintext strings and `local-plaintext-v1` stay readable, and a higher
store `schemaVersion` with a readable entry scheme is tolerated. This is what makes the freeze honest
across versions: an older consumer reading a newer OPAQUE/hardware store fails loudly instead of
silently handing back ciphertext as if it were the secret. Shipping the guard in the first public
`0.1.0` means a `0.1.0` consumer is forward-safe by construction, before any encrypted store exists.

## Boundary

- **Silo** owns storage shape, migration from legacy plaintext entries, status reporting, and
  namespace APIs.
- **Heartwood** owns signing, key derivation, OPAQUE-related primitives, and hardware-backed
  cryptographic paths.
- **Release/distribution packages** own provenance, availability, update, and rollback evidence.
- **Apps and consumers** render status and prompts, but do not own the storage or crypto contract.

No new package is created now because only Silo reads and writes this envelope. Extraction becomes
appropriate when another package must validate or transform envelopes without importing Silo.

## Consequences

### Positive

- `@refarm.dev/silo@0.1.0` can publish with a forward-compatible storage shape.
- Storage-only consumers stay light while still gaining a durable upgrade point for encryption.
- Downstream status surfaces can tell the truth: current protection is local owner-only, planned
  protection is OPAQUE/hardware-backed.
- P2P or multi-device work can replicate records with explicit protection metadata instead of
  guessing whether a blob is plaintext or encrypted.

### Risks

- Envelope metadata may be mistaken for encryption. Mitigation: the current scheme is named
  `local-plaintext-v1` and `encrypted: false`.
- Silo may accumulate too much cryptographic responsibility. Mitigation: Heartwood remains the
  crypto primitive owner; Silo only stores envelopes and calls crypto through future adapters.
- A future shared envelope contract may still be needed. Mitigation: defer extraction until there is
  a real second reader/writer.

## Implementation Notes

1. Store new `saveSecret` writes as envelope records.
2. Keep `loadSecret` and `listSecrets` returning string values.
3. Read legacy string entries as plaintext values.
4. Add `describeProtection()` and exported scheme constants.
5. Fold this into the initial Silo changeset; do not model pre-publication hardening as `0.1.1`.
