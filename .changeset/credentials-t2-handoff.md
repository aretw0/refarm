---
"@refarm.dev/credentials-contract-v1": minor
"@refarm.dev/identity-heartwood": minor
"@refarm.dev/storage-memory": minor
---

Promote the credentials:v1 seam into the vault-seed-ready handoff lane with a
reference issue -> verify -> present -> wallet proof. The contract composes
identity:v1 and storage:v1, identity-heartwood provides real Heartwood Ed25519
issuer/holder signatures, and storage-memory provides the volatile wallet
implementation for smoke and consumer-contract adoption.
