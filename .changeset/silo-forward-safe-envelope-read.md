---
"@refarm.dev/silo": patch
---

Make the secret protection scheme executable on read (ADR-077 forward-safety). A build that
encounters an envelope it cannot interpret — `encrypted: true` or an unknown `protection.scheme` —
no longer returns the raw stored value as if it were plaintext. `loadSecret` throws a typed
`UnreadableSecretError` (`code: "SILO_SECRET_UNREADABLE"`, `scheme`), and `listSecrets` omits the
unreadable entry while keeping readable siblings. Legacy plaintext strings and `local-plaintext-v1`
envelopes still read as before, and a higher store `schemaVersion` with a readable entry scheme is
tolerated. This locks the frozen consumer surface so a future OPAQUE/hardware store is never silently
handed back as ciphertext to an older consumer.
