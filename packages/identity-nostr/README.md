# @refarm.dev/identity-nostr

Nostr identity primitive — keypair management and decentralized plugin discovery via NIP-89/NIP-94. Implements the `identity:v1` contract. Usable independently of the full Refarm stack.

## When to use

- You need sovereign identity (keypair-based, no central server) for a Refarm user or device.
- You are implementing plugin discovery from Nostr relays (NIP-89 kind:31990 events).
- You need to verify WASM plugin integrity before loading (SHA-256 via NIP-94).

**Status:** Keypair generation and signing are pending `nostr-tools` integration — currently return placeholder values. Plugin discovery query shape is finalized.

## Installation

```bash
npm install @refarm.dev/identity-nostr
```

## Usage

### Keypair management

```typescript
import { NostrIdentityManager } from "@refarm.dev/identity-nostr";

const identity = new NostrIdentityManager();

// Generate a new keypair (sovereign, no registration required)
await identity.generateKeypair();
console.log(identity.publicKey); // hex pubkey

// Or load an existing one
await identity.loadKeypair({ publicKey: "...", secretKey: "..." });
```

### Plugin discovery (NIP-89)

```typescript
const plugins = await identity.discoverPlugins(
  ["wss://relay.damus.io", "wss://nos.lol"],
  { kind: "task-manager" } // optional filter
);

for (const plugin of plugins) {
  console.log(plugin.name, plugin.wasmUrl, plugin.integrityHash);
}
```

### WASM integrity verification (NIP-94)

```typescript
import { verifyWasmIntegrity } from "@refarm.dev/identity-nostr";

const buffer = await fetch(plugin.wasmUrl).then(r => r.arrayBuffer());
const valid = await verifyWasmIntegrity(new Uint8Array(buffer), plugin.integrityHash);
if (!valid) throw new Error("WASM integrity check failed");
```

## Nostr standards implemented

| NIP | Purpose |
|-----|---------|
| NIP-01 | Basic protocol — event structure, keypairs |
| NIP-07 | Browser extension signer (`window.nostr`) |
| NIP-89 | Plugin handler registry (kind:31990) |
| NIP-94 | File metadata + integrity hashes for WASM |

## Related ADRs

- [ADR-034](../../specs/ADRs/ADR-034-identity-adoption.md) — identity adoption strategy
- [ADR-035](../../specs/ADRs/ADR-035-device-verification.md) — device verification
- [ADR-032](../../specs/ADRs/ADR-032-proton-security.md) — mandatory signing and WASM security

## License

MIT
