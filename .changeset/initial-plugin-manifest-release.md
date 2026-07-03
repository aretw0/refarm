---
"@refarm.dev/plugin-manifest": minor
---

Initial public release of the plugin manifest schema

- **@refarm.dev/plugin-manifest**: Plugin manifest schema and validation helpers, full
  TypeScript typings, README with examples, ESM-only, Node 22+ compatible.
- Capability-policy decision helpers (`evaluateCapabilityGrant`, `decidePluginPolicy`): a pure
  admission decision — manifest plus an injected grant set in, a `{ status, missingCapabilities }`
  decision out — so a host (CLI/runtime/review command) supplies the grants and consumes the
  result. The grant set and the audit receipt stay host-owned.

Pre-publish baseline (split from `initial-contracts-release.md` on 2026-07-03): this is a
protected surface (serialized lock/handoff policy) and is not in the `vault-seed-ready`
first-publish lane. It must be first-published through its own explicit decision; fold further
pre-publication schema changes into this changeset instead of stacking new ones.
