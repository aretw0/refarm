# Refarm Courier (`@refarm.dev/plugin-courier`)

## The Courier of the Farm

If the Tractor (`@refarm.dev/tractor`) is the engine and the Cryptographic Keypair (`Identity`) is your farm's deed, **Courier** is how you deliver goods and messages to the outside world.

Because Refarm's identity is sovereign and transport-agnostic, we need a smart system to figure out *how* to deliver messages and sync CRDT graphs with other sovereign nodes. This is exactly the role of `@refarm.dev/plugin-courier`.

## Dynamic Courier Routing

The Courier acts as a multiplexer and discovery protocol. It doesn't care *who* you are (Tractor knows that), it only cares *where* the other person is and what is the cheapest/fastest way to reach them.

### 1. Local-First (The Intranet Farm)
If you and your partner are in the same house, on the same Wi-Fi, the Courier should ideally discover this (via mDNS / WebRTC Local Discovery) and establish a direct connection.

*Result:* Data syncs at Gigabit LAN speeds, completely bypassing the wider internet. No public relays are used. If the internet goes down, the Courier keeps the local farm synced.

### 2. Relay Fallback (The Global Farm)
If the peer is not found locally, the Courier falls back to public or private routing infrastructure (Relays).

*Result:* The Courier wraps the CRDT sync payloads in agnostic envelopes and broadcasts them to the relays you both trust. This could be a public Nostr relay, a private Matrix server, or a custom Refarm Relay running on a Raspberry Pi in your garage.

### 3. Every Node can be a Relay (P2P Mesh)
A core tenet of Refarm is that any instance of Homestead (the client) or Tractor (the engine) can technically act as a lightweight relay for others. If two users are offline, but a third user walks between them with an active Refarm on their phone, that third user can temporarily store and forward the encrypted syncing graphs.

### 4. Protocol Agnosticism
While Nostr is our current *recommended* wide-area network protocol because of its existing global relay network, the Courier plugin is designed to be extensible. Tomorrow, it could route packets over the AT Protocol, Matrix, or even Bluetooth Mesh (for offline mobile sync).

## The Flow

```text
[Tractor (Kernel/CRDT)]
       │
       ▼ (Agnostic Sync Payload)
[Plugin Courier]
       │
       ├─► [mDNS/WebRTC] ──► Peer on same Wi-Fi (Direct / Fast)
       │
       └─► [Relays] ──► Peer across the globe (Nostr, Private Node, etc.)
```

The Tractor just tells the Transport: "Sync this node with PubKey X".
The Transport figures out the rest.
