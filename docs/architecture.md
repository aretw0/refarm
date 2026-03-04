# Refarm Architecture

> **"Solo Fértil" — Fertile Soil for Sovereign Data"**

Refarm is a Personal Operating System for centralising and "reforming" data from multiple fragmented sources. It operates **offline-first**, stores everything in **SQLite/OPFS** in the user's browser, and uses **Nostr** as its decentralised plugin marketplace and sync backbone.

---

## Design Principles

| Principle | Meaning |
|---|---|
| **Offline-First** | All data lives in the browser (SQLite via OPFS). Network is optional. |
| **Radical Ejection Right** | Every primitive can be taken out and used in another project. No vendor lock-in. |
| **Sandboxed Plugins** | Plugins run as WASM components and communicate only through WIT-defined interfaces. |
| **Sovereign Graph** | All data is normalised to JSON-LD before persistence — semantically portable. |
| **Decentralised Discovery** | Plugin marketplace runs over Nostr (NIP-89/94). No central server. |

---

## Monorepo Map

```
refarm/
├── apps/
│   ├── kernel/          # 🌱 "Solo Fértil" — Core Kernel
│   │   └── src/
│   │       └── index.ts # Kernel class: boot, storeNode, queryNodes, PluginHost
│   │
│   └── studio/          # 🎨 Refarm Studio — In-browser IDE (Astro)
│       └── src/
│           ├── pages/   # index, plugins, graph, dev
│           └── layouts/
│
├── packages/            # 📦 Independent Primitives (no Refarm dependency)
│   ├── storage-sqlite/  # SQLite/OPFS adapter + migration runner
│   ├── identity-nostr/  # Nostr keypair + NIP-89/94 plugin discovery
│   └── sync-crdt/       # Vector clocks, LWW register, OR-Set, SyncEngine
│
├── wit/
│   └── refarm-sdk.wit   # WIT interface — plugin ↔ kernel communication
│
├── schemas/
│   └── sovereign-graph.jsonld  # JSON-LD schema + worked examples
│
├── docs/
│   └── architecture.md  # This file
│
├── turbo.json           # Turborepo task pipeline
├── package.json         # Workspace root
└── .gitignore           # Monorepo-aware ignores
```

---

## Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Refarm Studio                        │
│   (Astro SSG + WebContainers — apps/studio)             │
└───────────────────────┬─────────────────────────────────┘
                        │ uses
┌───────────────────────▼─────────────────────────────────┐
│                    Refarm Kernel                         │
│   (apps/kernel)                                         │
│   ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │
│   │PluginHost    │ │ Normaliser   │ │ SyncEngine    │  │
│   │(WASM sandbox)│ │(→ JSON-LD)   │ │(CRDT)         │  │
│   └──────┬───────┘ └──────┬───────┘ └──────┬────────┘  │
└──────────┼────────────────┼────────────────┼────────────┘
           │                │                │
    WIT boundary     ┌──────▼───────┐   ┌────▼──────────┐
           │         │storage-sqlite│   │  sync-crdt    │
┌──────────▼───┐     │  (OPFS/WAL) │   │(VectorClock,  │
│Plugin (WASM) │     └──────────────┘   │ LWW, OR-Set)  │
│ implements   │                        └───────────────┘
│ integration  │     ┌──────────────────────────────────┐
│ world        │     │       identity-nostr             │
└──────────────┘     │  (keypair + NIP-89 discovery)    │
                     └──────────────────────────────────┘
```

---

## Primitive Independence

Each package under `packages/` is a **standalone library**:

- **`@refarm/storage-sqlite`** — Can be imported in any web app needing offline-first SQLite. Zero Refarm-specific code.
- **`@refarm/identity-nostr`** — Can manage Nostr keys and discover NIP-89 apps in any context.
- **`@refarm/sync-crdt`** — Vector clocks, LWW registers, OR-Sets and a SyncEngine wirable to any transport.

If Refarm the product disappears, these three primitives continue working independently.

---

## Plugin System

### How a Plugin Communicates with the Kernel

```
Plugin (WASM Component)              Kernel (Host)
─────────────────────────            ─────────────────────
export integration {                 import kernel-bridge {
  setup() → result                     store-node(json-ld) → node-id
  ingest() → result<u32>               get-node(id) → json-ld
  push(payload) → result               query-nodes(type, limit) → list
  teardown()                           fetch(req) → response   ← capability-gated
  metadata() → plugin-metadata         log(level, msg)
}                                      request-permission(cap, reason) → bool
                                     }
```

All communication is **typed by the WIT contract** (`wit/refarm-sdk.wit`). The kernel host validates every call. Plugins cannot escape the sandbox.

### Plugin Distribution (Nostr)

1. Developer builds plugin → WASM binary
2. Developer publishes WASM to any URL, creates a **NIP-94 kind:1063** file metadata event with SHA-256 hash
3. Developer creates a **NIP-89 kind:31990** handler announcement event pointing to the NIP-94 event
4. Users discover plugins by querying relays for kind:31990 events
5. Kernel fetches and **verifies the WASM hash** before instantiation

---

## Data Flow: Plugin → Sovereign Graph

```
Raw data from plugin         Normaliser            SQLite/OPFS
(arbitrary JSON)      →→→   (JSON-LD)      →→→   nodes table
                                                   (payload column)

{ "wa_id": "5511...",        {                     INSERT OR REPLACE
  "name": "Alice",            "@context": "...",   INTO nodes ...
  "status": "Oi" }            "@type": "Person",
                              "@id": "urn:...",
                              "name": "Alice",
                              "refarm:sourcePlugin": "whatsapp-bridge"
                             }
```

See `schemas/sovereign-graph.jsonld` for worked examples of every node type.

---

## Getting Started

```bash
# Install all workspace dependencies
npm install

# Run all packages in dev mode (parallel via Turborepo)
npm run dev

# Build everything
npm run build

# Run tests
npm test
```

### Start the Studio only

```bash
cd apps/studio
npm run dev
```

### Build a specific package

```bash
cd packages/storage-sqlite
npm run build
```
