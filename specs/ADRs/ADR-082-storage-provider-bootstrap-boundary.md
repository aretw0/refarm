# ADR-082: Storage Provider Bootstrap Boundary

**Status**: Proposed
**Date**: 2026-07-03
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-009 (OPFS Persistence Strategy), ADR-010 (Schema Evolution),
ADR-076 (Silo Storage/Identity Closure Separation), ADR-081 (Local Surface
Boundary), `packages/storage-contract-v1`, `packages/storage-fs`,
`packages/storage-sqlite`, `packages/barn`, `docs/EXTENSIBILITY_MODEL.md`

---

## Context

Refarm needs a single, honest answer to "how is state persisted?" that serves
every surface at once (CLI/TUI/REPL/Web, VR on the roadmap) and empowers both
developers and agents — the composable/extensible compass of the project.

**Current situation:**

- `@refarm.dev/storage-contract-v1` already defines a backend-agnostic
  `StorageProvider` (`get`/`put`/`putMany`/`delete`/`deleteMany`/`query` over
  `StorageRecord { id, type, payload: string, createdAt, updatedAt }`).
  Backends already exist: `storage-memory`, `storage-sqlite` (Node),
  `storage-rest`, and the `silo` secret store.
- The install-ledger doctrine (see `docs/EXTENSIBILITY_MODEL.md` and the Barn
  storage docs) requires durable, atomic, scope-aware persistence on Node —
  a `.refarm/` ledger with user vs workspace scope — that never edits the
  original manifest. The atomic tmp+rename pattern was proven once, coupled to
  the scheduler, in `packages/windmill/src/local-scheduler-ledger.js`, and was
  being re-implemented ad hoc in several places without a shared block.
- The Barn install audit (`INSTALL_FLOW_AUDIT_20260423.md`, T-PLUGIN-01) flagged
  that Node-side persistence is process-local (in-memory Maps, no durable
  catalog); durable persistence only exists in the browser via OPFS.
- A recurring question: which of these primitives can be plugins, and which
  must the host guarantee? Refarm is white-label — the less the host hard-owns,
  the more a downstream can rebrand and extend. But some things are load-bearing
  for the very act of loading a plugin.
- The plugin binary cache (`PluginBinaryCacheAdapter` in `plugin-manifest`)
  moves `ArrayBuffer` WASM bytes; `StorageRecord.payload` is a `string`.

**Constraint (bootstrap):** `Barn.installPlugin` invokes the binary cache
adapter to persist bytes *inside* the install flow, before the plugin exists as
runnable code. Loading any plugin is therefore already an act of persistence.
A persistence backend cannot be provided by a plugin, because loading that
plugin would require the very backend it provides — a circular dependency.

---

## Decision

**We will treat the storage contract and a filesystem bootstrap backend as
host-guaranteed, keep JSON-record and binary-byte persistence as sibling
contracts, and allow additional backends to be plugins.** Concretely:

1. **`StorageProvider` (JSON records) is the agnostic intent contract.** Ledgers
   — install records, config overrides, scheduler entries, registry state — are
   all `StorageRecord`s. A plugin or block *intends* persistence (`put`/`get`)
   and never implements the mechanism; the backend is injected.

2. **`storage-fs` is the Node bootstrap backend, host-owned, not a plugin.**
   `NodeFsStorageProvider` stores one JSON file per store (a map `id → record`),
   with atomic writes (sibling temp file + `rename`, dir `0700` / file `0600`),
   mirroring the windmill precedent. It passes `runStorageV1Conformance` — the
   same suite as sqlite/memory. It is a *ledger* store (modest record counts,
   rewritten whole), deliberately not a database; large or high-churn datasets
   use `storage-sqlite`. `scope.ts` resolves `user` (`~/.refarm`) vs `workspace`
   (`./.refarm`) paths with a defined apply order (workspace wins on fold).

3. **Additional backends CAN be plugins.** `sqlite`, `rest`, and future
   backends (`p2p`, `s3`, exotic transports) can be provided by plugins, because
   by the time they load, the contract and a bootstrap backend already exist. A
   backend plugin implements the seven `StorageProvider` methods that already
   exist and the host registers it as one more available backend.

4. **JSON records and binary bytes are sibling contracts, not one.**
   `StorageProvider<record: JSON>` and `PluginBinaryCacheAdapter<bytes:
   ArrayBuffer>` share the *backend axis* (fs/OPFS/sqlite/rest/p2p) but not the
   data shape. Forcing WASM bytes into a base64 `payload: string` costs ~+33%
   size and an encode/decode on the plugin-load hot path, so they stay siblings.

**The host guarantees the contract and a bootstrap backend; a plugin assumes the
intent (and may assume additional backends).** The dividing test is: *does some
plugin need this to be loaded at all?* If yes, it is host (bootstrap). If no, it
may be a plugin.

---

## Alternatives Considered

### Option 1: A brand-new persistence package/mechanism
**Cons:**

- Ignores that `storage-contract-v1` already models exactly this intent. New
  mechanism = duplicate abstraction, more surface to keep in sync.
- Does not answer the bootstrap question; a fresh mechanism could still be
  mistakenly modeled as a plugin.

### Option 2: Make storage/fs a (core) plugin
**Cons:**

- Circular: loading the storage plugin needs the storage plugin to persist its
  own bytes. The primitive must precede any plugin.

### Option 3: Fuse records and bytes into one `StorageProvider` (bytes via base64)
**Pros:**

- Conceptually one contract.

**Cons:**

- ~+33% size and encode/decode on every WASM read — the plugin-load hot path.
  Trades real performance for conceptual tidiness.

### Chosen: siblings sharing a backend axis + fs bootstrap primitive
Increments existing blocks (no new mechanism), keeps the hot path clean, and
gives a crisp host-vs-plugin boundary that generalizes beyond storage.

---

## Consequences

**Positive:**

- One work on the backend axis serves every ledger (install/config/scheduler/
  registry) and every surface; a plugin only intends persistence.
- The bootstrap test (`does a plugin need it to load?`) is a reusable rule for
  where the host guarantees a surface vs where plugins assume it.
- `storage-fs` unblocks the durable Node install-ledger the audit asked for, and
  the atomic write pattern is no longer re-implemented per consumer.
- Future p2p/multi-device persistence is "just another `StorageProvider`."

**Negative / follow-up:**

- The Barn must be wired to inject a `StorageProvider` (storage-fs on Node) for
  its install ledger — not done in this ADR; today it is still in-memory.
- The user vs workspace scope precedence, now expressed in `storage-fs/scope.ts`,
  needs a `composeEffectiveManifest(manifest, overrides[])` consumer (pure, in
  `plugin-manifest`) to actually fold overrides.
- Binary-byte convergence (should `PluginBinaryCacheAdapter` share the same
  backend registry as `StorageProvider`?) is deferred to a future slice with
  evidence from a real fs-backed cache.

---

## References

- `packages/storage-contract-v1/src/types.ts` — the `StorageProvider` contract.
- `packages/storage-fs/` — the Node bootstrap backend (this ADR's primitive).
- `packages/windmill/src/local-scheduler-ledger.js` — atomic write precedent.
- `packages/barn/docs/INSTALL_FLOW_AUDIT_20260423.md` — T-PLUGIN-01 durability gap.
- `docs/EXTENSIBILITY_MODEL.md` — "Persistence & the bootstrap boundary".
