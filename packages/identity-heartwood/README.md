# @refarm.dev/identity-heartwood

Heartwood-backed `identity:v1` provider. It creates Ed25519 keypairs with
`@refarm.dev/heartwood` and signs/verifies through the `identity:v1` contract.

This package is an adapter, not the identity contract. Nostr, OPAQUE, WebAuthn,
hardware, or Silo-backed identities can provide the same contract through their
own packages.

```ts
import { createHeartwoodIdentityProvider } from "@refarm.dev/identity-heartwood";

const identity = createHeartwoodIdentityProvider();
const issuer = await identity.create("Issuer");
const proof = await identity.sign(issuer.id, "hello");
const result = await identity.verify(proof.signature, "hello");
```

## Boundary

- Owns: an in-process `identity:v1` provider backed by real Heartwood Ed25519
  signatures.
- Does not own: Nostr relays, DID resolution, credential wallets, Silo secret
  persistence, or issuer trust policy.
