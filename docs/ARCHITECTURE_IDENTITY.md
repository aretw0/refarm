# 🧬 Sovereign Identity Architecture

## The Core Principle: Total Agnosticism
Refarm is built on the premise of **Absolute Sovereignty**. This means the engine (`@refarm.dev/tractor`) must never be hard-coupled to any specific network, relay, or protocol—including Nostr.

"If the internet disappears, your Refarm node must continue to function."

### Sovereign Identity vs. Transport Identity

To achieve this, Refarm separates **Identity** from **Transport/Discovery**.

#### 1. The Sovereign Root (The Cryptographic Identity)
At its lowest level, your identity in Refarm is simply a cryptographic keypair (currently Ed25519).

- **Public Key**: This is your absolute, universal identifier within your own local graph and to any peers you meet.
- **Private Key**: This is your signing authority.

You *are* your own identifier. No intermediate server, relay, or domain name is required to prove you authorized a change to your data. All Sovereign Nodes (JSON-LD documents) in your local SQLite database are signed by this raw key.

#### 2. The Transport Layer (Nostr, Matrix, Local WebRTC)
Protocols like Nostr or Matrix are merely **Transport Adapters**. They act as "Post Offices."

While `@refarm.me/identity-nostr` is our recommended and default adapter (because it provides an excellent decentralized relay network for finding peers), it is **not mandatory**.

You could implement:

- `@refarm.dev/identity-local`: An adapter that only signs data locally and syncs directly with other computers on your LAN via mDNS and WebRTC. No relays involved.
- `@refarm.dev/identity-matrix`: An adapter using Matrix Homeservers as the transport layer.
- `@refarm.dev/identity-atproto`: An adapter for the Bluesky/AT Protocol network.

## Tractor's Agnostic Interface

If you look at `packages/identity-contract-v1/src/types.ts`, the `IdentityAdapter` capability is profoundly simple:

```typescript
export interface IdentityAdapter {
  publicKey?: string;
  sign?(data: string): Promise<{ signature: string; algorithm: string }>;
}
```

Notice there is no mention of `npub`, `relays`, or `events`. The Tractor engine only asks the adapter: "What is your public key?" and "Can you sign this byte array?".

### WASM Plugin Integrity
Similarly, the Tractor Kernel verifies the integrity of loaded plugins (`verifyWasmIntegrity`) not through Nostr, but by checking the Ed25519 signature embedded in the plugin's manifest against the actual SHA-256 hash of the `.wasm` binary.

**Conclusion:** Nostr is highly synergistic with Refarm, but Refarm answers to no one but the cryptographic math itself. You are your own server.
