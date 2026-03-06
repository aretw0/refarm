# ADR-005: Network Abstraction Layer Architecture

**Status**: Accepted  
**Date**: March 2026  
**Context**: Choosing how Refarm will handle multi-protocol networking (relays, P2P, federation)  
**Decision**: Network abstraction with Nostr as primary discovery + WebRTC P2P for sync. Matrix adapter is explicitly deferred post-MVP.  

---

## Problem Statement

Refarm is a **sovereign data system** but operates in a world of multiple networks:

1. **Users on different physical networks** (WiFi at home, cell network at work)
2. **Devices that need to sync** (phone ↔ laptop ↔ tablet)
3. **Communities that want to share data** across organizational boundaries
4. **Plugins that need to be discovered** and installed trustlessly

A **single network choice** fails here because:

- No single protocol is optimal for all use cases
- We risk vendor lock-in (e.g., "Refarm requires Matrix")
- Users should be able to choose their preferred sync transport

**Solution**: Build an **abstraction layer** that can switch between multiple transports based on context and availability.

---

## Decision: Nostr-First with Abstraction

## MVP Scope Freeze (v0.1.0-v0.2.x)

To keep implementation focused, this ADR defines a strict in/out scope for near-term delivery.

**In scope now**:

- Nostr relay adapter for identity-related publish/subscribe flows
- Nostr-based plugin discovery metadata (NIP-89/94)
- WebRTC adapter for peer-to-peer sync sessions
- Offline queueing when network is unavailable

**Out of scope now**:

- Matrix federation adapter and homeserver integration
- Multi-transport auto-failover beyond Nostr + WebRTC
- Cross-protocol bridge plugins (Matrix<->Nostr, IPFS<->Nostr)

**Re-entry rule**: Matrix only returns to scope after v0.1.0 core storage/sync gates are green and v0.2.x network telemetry shows clear need.

### Network Stack Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Application Layer                          │
│          (Plugins, Kernel, Studio)                      │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│     Network Abstraction Interface (NetworkAdapter)      │
│  - Abstracts away protocol details                      │
│  - Common operations: publish(), subscribe(), fetch()   │
└──────────┬─────────────┬─────────────┬──────────────────┘
           │             │             │
       ┌───▼────┐    ┌───▼─────┐   ┌───▼───────┐
       │ Nostr  │    │ WebRTC  │   │ Matrix    │
       │Relay   │    │  P2P    │   │ Federation│
       │ Adapter│    │ Adapter │   │ Adapter   │
       └────────┘    └─────────┘   └───────────┘
           │             │             │
    ┌──────▼─────────────▼─────────────▼─────────┐
    │      Platform Transports                   │
    │  - HTTP (Nostr relays, Matrix servers)     │
    │  - WebRTC (Local P2P)                      │
    │  - WebSocket (Server-mediated)             │
    └────────────────────────────────────────────┘
```

### Why Nostr as Primary Discovery Layer

#### 1. **Plugin Marketplace** (NIP-89/94)

Plugins are discovered via Nostr events:

- **NIP-89** (`kind:31990`): Handler announcement — "I understand this protocol"
- **NIP-94** (`kind:1063`): File metadata — WASM binary location + hash

**Advantage**: Decentralized, no central registry needed.

```
Developer writes plugin → Compiles to WASM → Publishes to URL →
Creates NIP-94 event (file metadata + hash) →
Creates NIP-89 event (points to NIP-94) →
Users query relays for NIP-89 events →
Kernel fetches WASM at URL, verifies hash → Loads plugin
```

#### 2. **User Identity** (NIP-01)

Every Refarm user has a Nostr identity (keypair):

- Derived from seed phrase (NIP-06)
- Signing key is permanent across sessions
- Can be used to delegate capabilities (NIP-26)

**Advantage**: User's identity is truly **sovereign** — not delegated to any platform.

#### 3. **Event Publishing** (NIP-01, NIP-23)

User's sovereign graph updates are publishable as Nostr events:

- **NIP-01** (`kind:1`): Social updates
- **NIP-23** (`kind:30023`): Long-form articles
- Custom kinds (30000-40000): Refarm-specific events

**Advantage**: User's graph is queryable by themselves and trusted communities, without platform dependency.

#### 4. **Relay Network** (NIP-01)

Relays are simple, stateless HTTP services:

- **Publish** a Nostr event: POST `/` with JSON
- **Subscribe** to events: WebSocket, filter by author/kind/tags
- Operators run relays at **zero financial cost** (query-filtering, ephemeral storage)

**Advantage**: Low operational burden for relay operators = more decentralization.

---

### Why NOT Single-Protocol?

#### IPFS / libp2p

**Pros**: Content-addressed, distributed hash table (DHT) for discovery  
**Cons**:

- Relative immutability (hard to revoke compromised files)
- Heavy client footprint in browser (IPFS.js adds ~2MB compressed)
- Relay/pinning infrastructure still needed for availability (→ more centralization)

**For Refarm**: IPFS could be a fallback for plugin distribution, but Nostr is leaner.

#### Matrix Federation

**Pros**: Mature protocol, room-based organization, excellent for multiparty chat  
**Cons**:

- API is HTTP-only (no WebRTC alternative in protocol)
- Homeserver selection is manual and opinionated
- Plugin discovery isn't a native concern (would require custom client code)

**For Refarm**: Matrix is excellent for **device-to-device sync** (v0.2.0), but not for **plugin marketplace discovery**.

#### Centralized Registry (HTTP)

**Pros**: Simple, fast, familiar  
**Cons**:

- Single point of failure
- Censorship risk
- Vendor lock-in

**For Refarm**: Contradicts core mission of sovereignty.

---

## Implementation Strategy

### Phase 1 (v0.2.0): Nostr Identity + Event Publishing

Refarm users can:

- Generate keypair (NIP-06 mnemonic)
- Publish updates to configured relays
- Subscribe to other users' updates
- Publish plugin announcements (NIP-89)

**Adapter**: Simple HTTP POST/WebSocket for Nostr relay protocol.

### Phase 2 (v0.2.0+): WebRTC P2P Fallback

When **devices are on the same local network**:

- Kernel initiates WebRTC data channel between two Refarm instances
- CRDT sync happens over P2P (doesn't need relay)
- Falls back to Nostr relays if WebRTC fails

**Adapter**: WebRTC RTCDataChannel for binary protocol negotiation.

### Phase 3 (Post-MVP): Matrix Federation [Optional]

For teams/organizations wanting their own sync infrastructure:

- Can run Matrix homeserver internally
- Refarm connects as a custom federated client
- Matrix room = sync channel for CRDT state

**Adapter**: Matrix Client-Server API (HTTP, room events).

### Phase 4 (Post-MVP): Intelligent Failover

Kernel detects availability and chooses transport:

- **Local network detected** → Use WebRTC P2P
- **Relay accessible** → Use Nostr
- **Homeserver available** → Use Matrix
- **All down** → Work offline, queue events, sync when available

---

## Security & Trust Model

### Plugin Hash Verification

```
1. Find NIP-89 event from author
2. Extract URL from NIP-94 event  
3. Fetch WASM from URL
4. Compute SHA-256 hash of WASM
5. Compare with hash declared in NIP-94
6. If match → Load; if mismatch → Reject
```

**Question**: How does user **trust** the plugin author?

**Answer** (future, v1.0+):

- Community ratings (similar to GitHub stars on Nostr)
- Author verification (domain ownership via DNS)
- Sandbox restrictions (plugin can only access certain capabilities)

### Relay Selection

User configures trusted relay list (e.g., `["wss://relay.example.com", "wss://relay2.example.com"]`).

**Why multiple relays**?

- Redundancy (if one is down, query others)
- Privacy (spread queries across multiple relays)
- Community (participate in relay ecosystem without dependency on single entity)

---

## Comparison Table

| Aspect | Nostr | IPFS | Matrix | Centralized |
|--------|-------|------|--------|-------------|
| **Plugin Discovery** | ✅ (NIP-89/94) | ⚠️ (custom) | ⚠️ (custom) | ✅ (simple) |
| **User Identity** | ✅ (keypair) | ⚠️ (DHT-based) | ⚠️ (homeserver) | ✅ (accounts) |
| **Scalability** | ✅ (stateless relays) | ✅ (DHT) | ⚠️ (heavy servers) | ✅ (servers) |
| **Decentralization** | ✅ (operator choice) | ✅ (node operators) | ⚠️ (federation) | ❌ |
| **Censorship Resistant** | ✅ (data replicates) | ✅ (content-addressed) | ⚠️ (depends) | ❌ |
| **Low Bandwidth** | ✅ (~1KB event) | ⚠️ (higher overhead) | ❌ (room sync) | ✅ |
| **Browser-Friendly** | ✅ (WebSocket) | ⚠️ (heavy JS) | ✅ (HTTP) | ✅ |

---

## Open Questions & Future Work

1. **Rating System**: How do users rate/trust plugins without central authority?
   - Solution: Proof-of-Work reputation (expensive to spam)
   - Alternative: Web of trust (users endorse other users' endorsements)

2. **Revocation**: What if a plugin is compromised?
   - Current: Delete from Nostr (but cached copies remain)
   - Future: Kernel maintains a local blocklist, syncs revocations via relays

3. **Privacy**: Relay operators can see publish operations?
   - Mitigation: Encrypt event content before publishing
   - Future: Implement encrypted DMs (NIP-17) for plugin distribution

4. **Interop**: Can Refarm users on different networks still sync?
   - Yes: Bridge plugins (Matrix↔Nostr, IPFS↔Nostr) can translate between protocols
   - Vision: "Any transport, any protocol" via adapters

---

## Conclusion

**Nostr + abstraction layers** provide:

- ✅ **Decentralized discovery** (plugins via NIP-89/94)
- ✅ **User sovereignty** (identity via keypairs)
- ✅ **Reliability** (multiple relay/protocol options)
- ✅ **Minimal dependencies** (Nostr events are tiny, HTTP-based)
- ✅ **Community-driven** (relay operators, plugin authors, users all participate)

The abstraction layer ensures Refarm doesn't become "Nostr-dependent" — we treat Nostr as the **primary protocol** but leave room for alternatives as the ecosystem evolves.

---

## References

- [NIP-01: Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-06: Basic key derivation from seed](https://github.com/nostr-protocol/nips/blob/master/06.md)
- [NIP-23: Long-form Content](https://github.com/nostr-protocol/nips/blob/master/23.md)
- [NIP-26: Delegated Event Signing](https://github.com/nostr-protocol/nips/blob/master/26.md)
- [NIP-89: Recommended Application Handlers](https://github.com/nostr-protocol/nips/blob/master/89.md)
- [NIP-94: File Metadata](https://github.com/nostr-protocol/nips/blob/master/94.md)
