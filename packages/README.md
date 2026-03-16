# Refarm Package Registry

This document catalogues the modular primitives and engines of the Refarm monorepo.

## 📦 Core Engines

| Package | Purpose | Maturity | Status |
|---|---|---|---|
| [`@refarm.dev/tractor`](./tractor) | The Sovereign Microkernel & Plugin Host | 🟡 Stable-ish | Internal |
| [`@refarm.dev/windmill`](./windmill) | Automation Engine & Infrastructure | 🟠 Alpha | Internal |
| [`@refarm.dev/health`](./health) | Stratified Health & Policy Auditor | 🟢 Production | **Ready** |

## 🛡 Capability Contracts (v1)
These packages define the interoperability layers between Refarm and its plugins.

| Package | Tests | Status | Publishing |
|---|---|---|---|
| [`@refarm.dev/storage-contract-v1`](./storage-contract-v1) | ✅ 6 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/identity-contract-v1`](./identity-contract-v1) | ✅ 2 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/sync-contract-v1`](./sync-contract-v1) | ✅ 2 Tests | 🟢 Ready | **Target v0.1.0** |
| [`@refarm.dev/plugin-manifest`](./plugin-manifest) | ✅ Validation | 🟢 Ready | **Target v0.1.0** |

## 🔌 Storage & Identity Adapters

| Package | Type | Backend | Maturity |
|---|---|---|---|
| [`@refarm.dev/storage-sqlite`](./storage-sqlite) | Storage | OPFS/SQLite | 🟡 Beta |
| [`@refarm.dev/storage-memory`](./storage-memory) | Storage | In-Memory | 🟢 Stable |
| [`@refarm.me/identity-nostr`](./identity-nostr) | Identity | Nostr/Relays | 🟡 Beta |
| [`@refarm.dev/sync-crdt`](./sync-crdt) | Sync | Automerge-like | 🟠 Alpha |

## 🏗 Sub-systems & Utilities

- **[`@refarm.dev/silo`](./silo)**: Context & Secret Provisioning.
- **[`@refarm.dev/fence`](./fence)**: Scope & Boundary Auditing.
- **[`@refarm.dev/thresher`](./thresher)**: Data Ingestion & Transformation.
- **[`@refarm.dev/heartwood`](./heartwood)**: Cryptographic Core (WASM).
- **[`@refarm.dev/cli`](./cli)**: The sovereign command-line interface.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
