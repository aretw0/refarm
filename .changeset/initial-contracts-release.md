---
"@refarm.dev/storage-contract-v1": minor
"@refarm.dev/identity-contract-v1": minor
"@refarm.dev/artifact-contract-v1": minor
"@refarm.dev/effort-contract-v1": minor
---

Initial public release of the capability contracts in the `vault-seed-ready` first-publish lane

- **@refarm.dev/storage-contract-v1**: Storage capability contract (storage:v1) with conformance test suite
- **@refarm.dev/identity-contract-v1**: Identity capability contract (identity:v1) with conformance test suite and optional session-derived identity handles for OPAQUE, WebAuthn, and future protocol-owned sessions
- **@refarm.dev/artifact-contract-v1**: Managed artifact lifecycle and task output manifests with provenance, tokenized producer process references, hashes, media types, review state, and consumer selection helpers
- **@refarm.dev/effort-contract-v1**: Effort lifecycle contract for durable work attempts, status transitions, provider-neutral provenance, and downstream handoff evidence

All packages include:

- Full TypeScript typings
- Comprehensive conformance test suites for implementation validation
- Detailed README with usage examples
- ESM-only, Node 22+ compatible

(`@refarm.dev/sync-contract-v1` and `@refarm.dev/plugin-manifest` were split out of this
changeset on 2026-07-03: they are not in the `vault-seed-ready` first-publish lane and keep
their own initial-release baselines so their versioning fate stays decoupled.)
