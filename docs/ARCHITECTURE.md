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
│   └── homestead/          # 🎨 Refarm Homestead — In-browser Admin/IDE (Astro)
│       └── src/
│           ├── pages/      # Dashboard, plugins, graph, dev
│           └── layouts/
│
├── packages/               # 📦 Independent Primitives (cultivated by Tractor)
│   ├── tractor/            # 🚜 Refarm Tractor — The machinery/host orchestrator
│   ├── storage-sqlite/     # Offline-first SQLite/OPFS adapter
│   ├── storage-pglite/     # Postgres WASM adapter for embeddings/AI
│   ├── identity-nostr/     # Nostr keypair + NIP-89/94 discovery
│   ├── sync-crdt/          # SyncEngine + Conflict-free replication
│   ├── plugin-manifest/    # Schema & validation for the WASM sandbox
│   └── storage-memory/     # Volatile in-memory primitive for testing
│
├── wit/
│   └── refarm-sdk.wit      # WIT interface — plugin ↔ tractor communication
│
├── schemas/
│   └── sovereign-graph.jsonld  # JSON-LD schema — the "Solo Fértil" data layer
│
├── docs/
│   └── ARCHITECTURE.md     # This file
│
├── turbo.json              # Turborepo task pipeline
├── package.json            # Workspace root
└── .gitignore              # Monorepo-aware ignores
```

---

## Layer Diagram

![Layer Diagram](./diagrams/layer-diagram.svg)
[View source](file:///workspaces/refarm/docs/diagrams/layer-diagram.mermaid)

---

## Primitive Independence

Each package under `packages/` is a **standalone library**:

- **`@refarm.dev/storage-sqlite`** — Can be imported in any web app needing offline-first SQLite. Zero Refarm-specific code.
- **`@refarm.dev/storage-pglite`** — Postgres in the browser via WASM/WebGPU path.
- **`@refarm.me/identity-nostr`** — Manages Nostr keys. A Transport-specific Identity adapter.
- **`@refarm.dev/sync-crdt`** — Vector clocks, LWW registers, OR-Sets and a SyncEngine wirable to any transport.
- **`@refarm.dev/plugin-courier`** — The dynamic "Courier/Router". It abstracts the network layer, automatically figuring out if peers are on the same local network (mDNS/WebRTC) or if it needs to bounce signals off Public/Private Relays. Anyone running Refarm can operate their own Relay. It provides location-agnostic peer discovery and transport routing.

**Crucial Distinction on Independence:**
While the *plugins* you write for Refarm are tightly coupled to the Tractor's WASM Sandbox (they don't make sense without the engine), the core primitives listed above (`storage-sqlite`, `storage-pglite`, core `identity`, and pure `sync-crdt` logic) are designed as agnostic libraries. If the Refarm UI disappears, you can still import these specific packages into a standard Node.js/Browser project and continue reading your local data or syncing via CRDTs.

---

## Plugin System

### How a Plugin Communicates with the Tractor (Microkernel)

Refarm aligns with the **WebAssembly System Interface (WASI)**. Plugins use standard syscalls, gated by Tractor's capability manager.

```
Plugin (WASM Component)              Tractor (WASI Host)
─────────────────────────            ─────────────────────
import wasi:http/types               exports wasi:http/handler
import wasi:filesystem/preopens      implements wasi:filesystem
                                     
export integration {                 implements tractor-bridge {
  setup() → result                     store-node(json-ld) → node-id
  ingest() → result<u32>               get-node(id) → json-ld
}                                    }
```

All communication is **typed by WIT contracts**. The tractor host validates every call. Plugins cannot escape the sandbox. Use of WASI ensures that native libraries can run in Refarm with minimal shim logic.

### Plugin Distribution (Nostr)

1. Developer builds plugin → WASM binary
2. Developer publishes WASM to any URL, creates a **NIP-94 kind:1063** file metadata event with SHA-256 hash
3. Developer creates a **NIP-89 kind:31990** handler announcement event pointing to the NIP-94 event
4. Users discover plugins by querying relays for kind:31990 events
5. Tractor fetches and **verifies the WASM hash** before instantiation

---

## Guest Mode & Collaborative Sessions

### Identity-Orthogonal Guest Architecture

Refarm supports **guest sessions** for zero-friction onboarding. The key design principle: **Guest = no keypair, NOT no storage.** Storage tier is a user choice, orthogonal to identity status.

```
┌─────────────────────────────────────────────────────────┐
│       IDENTITY AXIS          ×        STORAGE AXIS      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔓 GUEST (no keypair)         [Ephemeral]              │
│  ├─ Identity: vaultId (UUID)   │ sessionStorage         │
│  ├─ Signing: ❌                │ Tab closes = gone      │
│  ├─ Nostr relay: ❌            ├─────────────────────── │
│  └─ Upgrade: opt-in           [Persistent]              │
│                                │ OPFS/SQLite             │
│         ↓ [Create Identity] ↓  │ Survives restart        │
│                                ├─────────────────────── │
│  🔐 PERMANENT (Nostr keypair) [Synced]                  │
│  ├─ Identity: pubkey (BIP-39)  │ OPFS + WebRTC P2P      │
│  ├─ Signing: ✅                │ Multi-device            │
│  ├─ Nostr relay: ✅            │ (sync code for guests,  │
│  └─ Recovery: mnemonic        │  keypair for permanent)  │
│                                                         │
│  Any identity × Any storage = valid combination         │
└─────────────────────────────────────────────────────────┘
```

### Use Cases

1. **Discovery**: User clicks shared board link → instant access, no signup
2. **Collaboration**: Host shares "public" whiteboard, guests can view/edit in real-time
3. **File channels**: Some data is inherently public (docs, diagrams) and doesn't need identity
4. **Education**: Teachers present, students join as guests to participate

### How It Works

**Guest joins a board** (choosing persistent storage):

```typescript
// 1. User opens link: refarm.dev/board/abc123
// 2. Tractor detects no identity → creates guest session with storage choice
const vaultId = crypto.randomUUID(); // "vault-a7c3f2"

// 3. Guest picks storage tier (ephemeral / persistent / synced)
// If persistent or synced → OPFS/SQLite (same as permanent users)
localStorage.setItem("refarm:vault", JSON.stringify({
  vaultId,
  type: "guest",
  storageTier: "persistent",
  createdAt: Date.now()
}));

// Instantiate the adapters in the host (Homestead)
const storage = await new OPFSSQLiteAdapter().open(vaultId);
const identity = new EphemeralIdentity(vaultId);

// 4. Boot Tractor with injected adapters
const tractor = await Tractor.boot({ storage, identity });

// 5. Guest creates nodes — same API as permanent users
tractor.storeNode({
  "@type": "StickyNote",
  "@id": `urn:${vaultId}:note-1`,
  text: "Draft idea",
  "refarm:owner": vaultId  // vaultId instead of pubkey
});
```

**Migration to permanent identity** (storage stays the same):

```typescript
// User clicks "Create Identity" → generates Nostr keypair
const keypair = await identityNostr.generateKeypair();

// Rewrite ownership across all nodes (vaultId → pubkey)
const allNodes = await storageSqlite.queryAll(vaultId);
for (const node of allNodes) {
  node["@id"] = node["@id"].replace(vaultId, keypair.pubkey);
  node["refarm:owner"] = keypair.pubkey;
  await storageSqlite.update(node);
}

// NOTE: Storage backend stays the same — no data migration needed
localStorage.setItem("refarm:identity", keypair.pubkey);
```

### What Guests CAN'T Do (Only Signing-Dependent Operations)

| Restriction | Reason |
|-------------|--------|
| Publish to Nostr relays | Requires keypair signing |
| Publish plugins (NIP-89/94) | Requires keypair signing |
| Own governance boards | Requires signature for authority |
| Recover via mnemonic on new device | No mnemonic exists |

Everything else — storage, AI, plugins, collaboration, export, P2P sync — is available to guests.

### Security: Vault-Based Isolation

Each user (guest or permanent) has their own vault, scoped by vaultId or pubkey:

```typescript
// Guest queries are scoped to their vault
const myNodes = await tractor.queryNodes({ owner: activeVaultId });
// Returns only data belonging to the current user

// Host configures board permissions
{
  "@type": "CollaborativeBoard",
  "@id": "urn:alice:board-123",
  "refarm:guestPolicy": {
    "allow": true,
    "permissions": ["read", "write"],
    "maxGuests": 10,
    "allowPersistentStorage": true  // Host can restrict guests to ephemeral
  }
}
```

See [ADR-006: Guest Mode](../specs/ADRs/ADR-006-guest-mode-collaborative-sessions.md) for detailed design.

---

## Data Flow: Plugin → Sovereign Graph

```
Raw data from plugin         Normaliser            SQLite/OPFS
(arbitrary JSON)      →→→   (JSON-LD)      →→→   nodes table
                                                   (payload column)

{ "user_id": "@alice:...",   {                     INSERT OR REPLACE
  "name": "Alice",            "@context": "...",   INTO nodes ...
  "status": "Online" }        "@type": "Person",
                              "@id": "urn:...",
                              "name": "Alice",
                              "refarm:sourcePlugin": "matrix-bridge"
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

### Start the Homestead only

```bash
cd apps/homestead
npm run dev
```

### Build a specific package

```bash
cd packages/storage-sqlite
npm run build
```
