# Refarm Package Registry

This document catalogues the modular primitives and engines of the Refarm monorepo.

## 📦 Core Engines

| Package | Purpose | Maturity | Status |
|---|---|---|---|
| [`@refarm.dev/tractor`](./tractor) | The Sovereign Microkernel & Plugin Host | 🟡 Stable-ish | Internal |
| [`@refarm.dev/windmill`](./windmill) | Automation Engine & Infrastructure | 🟠 Alpha | Internal |
| [`@refarm.dev/health`](./health) | Stratified Health & Policy Auditor | 🟢 Production | **Ready** |

## 🛡 Capability Contracts (v1)
These packages define the foundational interoperability layers between Refarm and its plugins.

| Package | Tests | Status | Publishing |
|---|---|---|---|
| [`@refarm.dev/storage-contract-v1`](./storage-contract-v1) | ✅ 6 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/identity-contract-v1`](./identity-contract-v1) | ✅ 2 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/sync-contract-v1`](./sync-contract-v1) | ✅ 2 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/channel-policy-v1`](./channel-policy-v1) | ✅ Fixture Validation | 🟡 Candidate | **vault-seed-ready candidate** |

## 🔖 Plugin Metadata
This layer waits for the Pi and multi-layer plugin architecture proofs before entering the release lane.

| Package | Tests | Status | Publishing |
|---|---|---|---|
| [`@refarm.dev/plugin-manifest`](./plugin-manifest) | ✅ Validation | 🟡 Deferred | v0.2.0+ candidate |

## 🔌 Storage & Identity Adapters

| Package | Type | Backend | Maturity |
|---|---|---|---|
| [`@refarm.dev/storage-sqlite`](./storage-sqlite) | Storage | OPFS/SQLite | 🟡 Beta |
| [`@refarm.dev/storage-memory`](./storage-memory) | Storage | In-Memory | 🟢 Stable |
| [`@refarm.me/identity-nostr`](./identity-nostr) | Identity | Nostr/Relays | 🟠 Alpha (Experimental) |
| [`@refarm.dev/sync-crdt`](./sync-crdt) | Sync | Automerge-like | 🟠 Alpha |

## 🏗 Sub-systems & Utilities

- **[`@refarm.dev/silo`](./silo)**: Context & Secret Provisioning.
- **[`@refarm.dev/fence`](./fence)**: Scope & Boundary Auditing.
- **[`@refarm.dev/thresher`](./thresher)**: Data Ingestion & Transformation.
- **[`@refarm.dev/heartwood`](./heartwood)**: Cryptographic Core (WASM).
- **[`@refarm.dev/cli`](./cli)**: Shared CLI primitives, process adapters, JSON
  envelopes, and compatibility Refarm contracts. The executable Refarm app lives
  in `apps/refarm`.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
