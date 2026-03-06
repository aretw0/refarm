# ADR-006: Guest Mode and Collaborative Sessions

**Status**: Proposed  
**Date**: March 2026  
**Context**: Reducing friction for first-time users and enabling collaborative experiences  
**Decision**: Guest = no keypair (identity-orthogonal). Storage is a user choice, not an identity restriction.

---

## Problem Statement

**User acquisition friction**: Requiring identity creation (12-word mnemonic) upfront creates barriers:

- Users can't "try before they buy"
- Collaborative experiences (like Miro, Figma, Google Docs) need guests
- Not every interaction needs permanent identity

**Use cases that need guest mode**:

1. **Discovery**: User clicks link to Refarm board, wants instant access
2. **Collaboration**: Host shares "public" board, guests can view/edit
3. **File channels**: Some files are "public read" by design (docs, diagrams)
4. **Demo/education**: Teachers, presenters want audience to participate without signup

**The question**: Can Refarm support anonymous/guest users while maintaining sovereignty principles?

---

## Key Insight: Identity ≠ Storage

The fundamental distinction is:

- **Guest** means **no Nostr keypair** — not "no storage"
- **Storage tier** is a user choice, orthogonal to identity status
- Restrictions should only apply to operations that **require cryptographic signing**

A guest who wants to persist data locally (OPFS/SQLite) should be able to. A guest who wants to sync between two devices via a sync code should be able to. The only thing a guest truly *cannot* do is sign Nostr events — because they have no keypair.

---

## Decision: Identity-Orthogonal Guest Sessions with Storage Choice

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Refarm Kernel                               │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     IDENTITY AXIS                             │  │
│  │                                                                │  │
│  │   [Guest]                              [Permanent]             │  │
│  │   Random UUID (vaultId)                Nostr keypair (BIP-39)  │  │
│  │   No signing capability                Full signing            │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                              ×                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     STORAGE AXIS                              │  │
│  │                                                                │  │
│  │   [Ephemeral]          [Persistent]         [Synced]           │  │
│  │   sessionStorage       OPFS/SQLite          OPFS + WebRTC P2P  │  │
│  │   Tab closes = gone    Survives restart     Multi-device        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Any identity × Any storage = valid combination                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Storage Tiers (Available to ALL Users)

#### Tier 1: Ephemeral (`sessionStorage`)

- Data lives in `sessionStorage` — cleared when tab closes
- No persistence across browser sessions
- Use case: Quick collaboration, try-before-you-commit

```javascript
// Guest OR permanent user can choose ephemeral mode
const session = {
  storageMode: "ephemeral",
  backend: sessionStorage,
};
```

#### Tier 2: Persistent (`OPFS/SQLite`)

- Data stored in OPFS via SQLite — survives browser restart
- Guest gets a `vaultId` (stored as session metadata in `localStorage`)
- No cross-device sync, but data is durable

```javascript
// Guest with persistent storage
const session = {
  storageMode: "persistent",
  vaultId: crypto.randomUUID(), // e.g., "vault-a7c3f2"
  backend: storageSqlite,       // Same SQLite as permanent users
};

// Session metadata stored in localStorage (survives restart)
localStorage.setItem("refarm:vault", JSON.stringify({
  vaultId: session.vaultId,
  type: "guest",
  storageTier: session.storageMode,
  createdAt: Date.now(),
}));
```

#### Tier 3: Synced (`OPFS + WebRTC P2P`)

- Same as Tier 2 + sync between devices via WebRTC
- Guest uses a **sync code** (e.g., 6-digit numeric) instead of mnemonic
- Sync code = temporary key for P2P handshake (device-to-device only)
- No Nostr relay involved (P2P only)

```javascript
// Guest with multi-device sync
const session = {
  storageMode: "synced",
  vaultId: "vault-a7c3f2",
  syncCode: generateSyncCode(), // e.g., "482917"
  backend: storageSqlite,
  transport: "webrtc",          // P2P only, no Nostr relay
};

// Device B joins:
// 1. Opens Refarm → "Join existing vault"
// 2. Enters sync code → WebRTC handshake
// 3. CRDT sync transfers all data
// 4. Both devices share same vaultId
```

### Guest Session Lifecycle

1. **Creation**: User opens Refarm link without identity

   ```javascript
   // Kernel detects no identity
   const vaultId = crypto.randomUUID();
   
   // Prompt storage choice
   // "How would you like to store your data?"
   // [Just browsing (ephemeral)] [Keep locally] [Sync between devices]
   ```

2. **Storage choice**: Guest selects tier

   ```javascript
   if (storageChoice === "ephemeral") {
     sessionStorage.setItem("refarm:vault", JSON.stringify({
       vaultId,
       type: "guest",
       storageTier: "ephemeral",
       createdAt: Date.now(),
     }));
   } else {
     // Persistent or Synced → use OPFS/SQLite
     localStorage.setItem("refarm:vault", JSON.stringify({
       vaultId,
       type: "guest",
       storageTier: storageChoice,
       createdAt: Date.now(),
     }));
     await storageSqlite.initVault(vaultId);
   }
   ```

3. **Usage**: Guest creates, edits, queries — same APIs as permanent user

   ```javascript
   // Guest stores nodes — same API, same SQLite
   kernel.storeNode({
     "@type": "StickyNote",
     "@id": `urn:${vaultId}:note-1`,
     text: "My idea",
     "refarm:owner": vaultId, // vaultId instead of pubkey
   });
   ```

4. **Sync** (Tier 3): Guest syncs via sync code

   ```javascript
   // Device A generates sync code
   const syncCode = generateSyncCode(); // "482917"
   // Display: "Enter this code on your other device: 482917"
   
   // Device B enters code → WebRTC handshake
   const connection = await webrtc.connectViaSyncCode(syncCode);
   await syncEngine.fullSync(connection);
   ```

5. **Upgrade Prompt**: At any point, guest can create permanent identity

   ```
   [Banner]
     Create a Nostr identity to:
       ✓ Publish plugins
       ✓ Sync via Nostr relays (in addition to P2P)
       ✓ Sign your data (provenance)
       ✓ Recover with mnemonic on any device
     [Create Identity]  [Stay Guest]
   ```

6. **Migration**: Guest clicks "Create Identity"

   ```javascript
   // 1. Generate Nostr keypair
   const keypair = await identityNostr.generateKeypair();
   
   // 2. Rewrite node ownership (vaultId → pubkey)
   const allNodes = await storageSqlite.queryAll(vaultId);
   for (const node of allNodes) {
     node["@id"] = node["@id"].replace(vaultId, keypair.pubkey);
     node["refarm:owner"] = keypair.pubkey;
     await storageSqlite.update(node);
   }
   
   // 3. Persist identity
   localStorage.setItem("refarm:identity", keypair.pubkey);
   
   // NOTE: Storage stays the same! No migration between backends.
   // If guest was already on Tier 2/3, data is already in SQLite.
   ```

---

## Guest Capabilities Matrix

| Capability | Guest | Permanent User | Why? |
|------------|-------|----------------|------|
| **Storage: sessionStorage** | ✅ | ✅ | Storage is a choice |
| **Storage: OPFS/SQLite** | ✅ | ✅ | Storage is a choice |
| **Identity** | Random UUID (vaultId) | Nostr keypair | Guest has no keypair |
| **Sync: WebRTC P2P** | ✅ (via sync code) | ✅ | P2P doesn't need signing |
| **Sync: Nostr relay** | ❌ | ✅ | Requires event signing |
| **Use plugins** | ✅ (if plugin supports) | ✅ | Plugin decides |
| **Create boards** | ✅ (local only) | ✅ (local + publishable) | Creation is local |
| **Join shared boards** | ✅ (if host allows) | ✅ | Host decides |
| **Edit shared data** | ✅ (if permissions granted) | ✅ | Permission-based |
| **Run local AI** | ✅ | ✅ | AI is local, no identity needed |
| **Export data** | ✅ | ✅ | Data ownership is universal |
| **Publish to Nostr** | ❌ | ✅ | **Requires keypair signing** |
| **Publish plugins** | ❌ | ✅ | **Requires NIP-89/94 signing** |
| **Own governance boards** | ❌ | ✅ | **Requires signature for authority** |
| **Recover on new device (mnemonic)** | ❌ | ✅ | **No mnemonic = no recovery** |

**Summary**: Guest can do **everything** except operations that require **cryptographic signing**. Storage, AI, plugins, collaboration, export — all available.

---

## Plugin Considerations

### How Plugins Know User is Guest

```typescript
const identity = await bridge.getIdentity();
if (identity.type === "guest") {
  // User has no keypair — cannot sign events
  // But CAN have persistent storage (check storageTier)
  const tier = identity.storageTier; // "ephemeral" | "persistent" | "synced"
  this.bridge.log("info", `[plugin] Guest user, storage: ${tier}`);
} else {
  // Permanent user with Nostr keypair
  this.bridge.log("info", `[plugin] User is @${identity.pubkey}`);
}
```

### Plugin Metadata: Guest Support Declaration

```json
{
  "name": "Collaborative Board",
  "version": "1.0.0",
  "guestMode": {
    "supported": true,
    "capabilities": ["read", "write"],
    "restrictions": ["no-nostr-publish"]
  }
}
```

**Examples**:

- **Matrix Bridge**: `guestMode: null` → Guests can't use (needs identity for API authentication)
- **Whiteboard Plugin**: `guestMode: { supported: true }` → Guests participate fully
- **Backup Plugin**: `guestMode: { supported: true }` → Guests with persistent storage CAN backup
- **Nostr Publisher**: `guestMode: null` → Requires keypair for signing

---

## Security Model

### Guest Isolation

**Problem**: Can guest access permanent user's data?

**Solution**: Vault-based isolation — each user (guest or permanent) has their own vault.

```javascript
// Guest vault
kernel.storeNode({
  "@type": "StickyNote",
  "@id": "urn:vault-a7c3f2:note-1",     // Scoped to guest vaultId
  text: "Guest's draft idea",
  "refarm:owner": "vault-a7c3f2"
});

// Permanent user vault
kernel.storeNode({
  "@type": "Message",
  "@id": "urn:npub1abc...:msg-1",         // Scoped to pubkey
  text: "Alice's important message",
  "refarm:owner": "npub1abc..."
});

// Queries are scoped to the active vault
const myNodes = await kernel.queryNodes({ owner: activeVaultId });
// Returns only data belonging to the current user
```

### Host Control: Who Can Join as Guest?

```javascript
{
  "@type": "CollaborativeBoard",
  "@id": "urn:alice:board-project-planning",
  "refarm:guestPolicy": {
    "allow": true,
    "permissions": ["read", "write"],
    "approvalRequired": false,
    "maxGuests": 10,
    "allowPersistentStorage": true  // Host can restrict guests to ephemeral
  }
}
```

**Examples**:

- Public board: `allow: true, approvalRequired: false`
- Private board: `allow: false` (guests blocked)
- Moderated board: `allow: true, approvalRequired: true` (host manually approves each guest)

### Sync Code Security (Tier 3)

The sync code mechanism for multi-device guests:

- **6-digit code**: Short-lived (expires after 5 minutes or first use)
- **Transport**: WebRTC data channel (encrypted, P2P)
- **No relay**: Sync code never touches a Nostr relay
- **One-time use**: Code is invalidated after successful connection
- **Rate limiting**: Max 3 failed attempts per 10 minutes

```javascript
// Device A generates sync code
const syncCode = {
  code: crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
  expiresAt: Date.now() + 5 * 60 * 1000,  // 5 minutes
  vaultId: "vault-a7c3f2",
  used: false,
};

// Device B validates
if (syncCode.used || Date.now() > syncCode.expiresAt) {
  throw new Error("Sync code expired or already used");
}
```

---

## Technical Implementation

### v0.1.0 Guest Mode (Core)

```typescript
// apps/kernel/src/session.ts
export type StorageTier = "ephemeral" | "persistent" | "synced";

export interface GuestSession {
  type: "guest";
  vaultId: string;
  storageTier: StorageTier;
  createdAt: number;
}

export interface PermanentSession {
  type: "permanent";
  identity: NostrKeypair;
  storageTier: StorageTier; // Even permanent users can choose tier
}

export class SessionManager {
  async initSession(): Promise<GuestSession | PermanentSession> {
    // Check if user has permanent identity
    const savedIdentity = localStorage.getItem("refarm:identity");
    
    if (savedIdentity) {
      return {
        type: "permanent",
        identity: await identityNostr.loadKeypair(savedIdentity),
        storageTier: "synced", // default for permanent users
      };
    }
    
    // Check if returning guest (has vault metadata in localStorage)
    const savedVault = localStorage.getItem("refarm:vault");
    if (savedVault) {
      const parsed = JSON.parse(savedVault) as GuestSession;
      return {
        type: "guest",
        vaultId: parsed.vaultId,
        storageTier: parsed.storageTier,
        createdAt: parsed.createdAt,
      };
    }
    
    // New visitor → prompt for storage choice
    return this.createNewGuestSession();
  }
  
  async createNewGuestSession(tier: StorageTier = "ephemeral"): Promise<GuestSession> {
    const vaultId = crypto.randomUUID();
    
    const payload = JSON.stringify({
      vaultId,
      type: "guest",
      storageTier: tier,
      createdAt: Date.now(),
    });

    if (tier === "ephemeral") {
      sessionStorage.setItem("refarm:vault", payload);
    } else {
      localStorage.setItem("refarm:vault", payload);
      await storageSqlite.initVault(vaultId);
    }
    
    return { type: "guest", vaultId, storageTier: tier, createdAt: Date.now() };
  }
  
  async upgradeToPermanent(session: GuestSession): Promise<PermanentSession> {
    const keypair = await identityNostr.generateKeypair();
    
    // Rewrite ownership across all storage
    const allNodes = await this.getAllNodes(session.vaultId);
    for (const node of allNodes) {
      await this.rewriteNodeOwnership(node, session.vaultId, keypair.pubkey);
    }
    
    // Persist identity (storage backend stays the same)
    localStorage.setItem("refarm:identity", keypair.pubkey);
    localStorage.removeItem("refarm:vault");
    
    return {
      type: "permanent",
      identity: keypair,
      storageTier: session.storageTier, // Preserve storage choice
    };
  }
}
```

### v0.2.0 Collaborative Sync (WebRTC)

```typescript
// Guest joins via WebRTC
const connection = await webrtc.connect(boardUrl);
connection.on("data", (payload) => {
  // Receive CRDT updates from host
  syncEngine.applyRemoteUpdate(payload);
});

// Guest sends updates
syncEngine.on("localUpdate", (update) => {
  connection.send(update);
});
```

---

## Trade-offs

### Why Not Full Identity for Guests?

**Option A**: Generate full Nostr keypair for guests (hidden from user)

- ✅ Uniform identity model
- ❌ User never sees mnemonic → can't recover if browser cache cleared
- ❌ Confusing UX (user thinks they're guest, but has hidden identity)
- ❌ Events signed by "nobody" pollute relay network

**Decision**: Explicit guest mode (no keypair) is clearer. Signing capability is the meaningful boundary.

### Why Allow Guests to Use SQLite/OPFS?

**Old assumption**: "Guest = sessionStorage only"

**Problem**: This artificially limits guests and conflates storage with identity.

- A student using Refarm daily on their laptop should persist data locally — even without an identity
- A team using Refarm for a sprint board doesn't need everyone to create Nostr keypairs
- Storage choice is about **durability preference**, not about **identity status**

**Decision**: Storage is orthogonal to identity. Any user (guest or permanent) can use any storage tier.

### Why Sync Codes Instead of Keypairs for Guest Multi-Device?

- **Simplicity**: 6-digit code is easier than 12-word mnemonic
- **Ephemerality**: Sync code is one-time use, mnemonic is forever
- **No signing**: Sync code is for WebRTC handshake only, not for Nostr events
- **Risk tolerance**: Guest accepts that losing all devices = losing data (no mnemonic recovery)

---

### Why sessionStorage (Not localStorage)?

**sessionStorage** clears when tab closes → **intentionally ephemeral**

**localStorage** persists forever → Could confuse user ("I was guest, now I have data?")

**Decision**: sessionStorage for guest, localStorage only after upgrade.

---

## Migration Path

### v0.1.0 → v0.2.0

- [ ] Guest sessions work offline (sessionStorage)
- [ ] Guest can view shared boards (WebRTC P2P)
- [ ] Guest can upgrade to permanent (migration flow)

### v0.2.0 → v0.3.0

- [ ] Host can configure guest permissions (read, write, admin)
- [ ] Guest edits are attributed (Guest-1234 made this change)

### v0.3.0 → v0.4.0

- [ ] Plugins can declare guest support in metadata
- [ ] Kernel filters plugin marketplace ("Show only guest-compatible plugins")

---

## User Research Questions

1. **How long does average guest session last?**
   - Metric: Time between first interaction and tab close
   - Hypothesis: <5 minutes → "Try it out" use case

2. **What triggers guest→permanent conversion?**
   - Metric: Actions taken before clicking "Create Identity"
   - Hypothesis: After creating 10+ nodes or staying 15+ minutes

3. **Do guests understand data is ephemeral?**
   - Metric: % who close tab without converting vs. % who convert
   - Test: A/B test banner text ("Guest mode ends when you close tab" vs. "Save your work")

---

## Alternative Considered: No Guest Mode

**Option**: Require identity upfront, no guest sessions.

**Pros**:

- Simpler architecture (no sessionStorage vs. OPFS split)
- Every user is permanent from Day 1

**Cons**:

- Higher barrier to entry (12-word mnemonic scares users)
- Can't support "public boards" / "view-only links"
- Misaligned with collaborative UX expectations (Miro, Figma allow guests)

**Verdict**: Guest mode is essential for adoption.

---

## References

- [User Story: Day 0 Guest Experience](../docs/USER_STORY.md#day-0-alice-tries-refarm-without-commitment)
- [Plugin Security Model](../specs/features/plugin-security-model.md)
- [Identity Stack](../packages/identity-nostr/README.md)
- [WebRTC Sync Strategy](./ADR-005-network-abstraction-layer.md#phase-2-webrtc-p2p-fallback)

---

## Decision Log

- **2026-03-05**: Proposed (this document)
- **TBD**: Review with team (validate trade-offs)
- **TBD**: Accepted (move to implementation in v0.1.0)
