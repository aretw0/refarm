# @refarm.dev/identity-provider-ref

The **sovereign identity provider** — a reference WASM component that proves the
one guarantee an in-process TypeScript provider cannot make:

> **The private key is generated and held inside the WASM sandbox, and never
> crosses the boundary.**

## Why this exists

The `IdentityProvider` contract (`@refarm.dev/identity-contract-v1`) has a TS
reference, `HeartwoodIdentityProvider`. It does the Ed25519 math in the real
`heartwood` WASM crypto core — but it keeps the secret key in JavaScript memory
(`secretKeyHex`) and passes it *back into* the core on every `sign`. The key
crosses the boundary. For a citizen's wallet (T2), whose entire premise is a
sovereign holder of their own keys, that is the wrong shape.

This crate inverts it. The `identity-provider` WIT interface promises, at
[`plugin-wit/wit/optional.wit`](../plugin-wit/wit/optional.wit), that *"the
private key never leaves the WASM sandbox."* Here that promise is structural:

- The `SigningKey` lives in module-local state (`thread_local`), born inside the
  module. **No exported function returns it.**
- `sign(payload)` takes only the payload — not a key. It reads the managed key
  from local state and returns just the signature.
- `public-key()` returns only the public half — the sole key material that ever
  crosses the boundary, by design.
- `derive-from-session(session-key)` is the OPAQUE unlock path: the host completes
  an AKE handshake and hands over a session key; the plugin derives and unlocks
  the identity *inside* the sandbox, returning an opaque handle. The host can
  then `sign`/`verify` but cannot extract the private key.

## The sandbox is the absence of imports

This crate targets the smallest world that carries a signer — `identity-plugin`,
which `include`s the base `plugin` world (imports only `tractor-bridge`) and adds
`export identity-provider`. It imports **no** `host-fs`, `host-shell`,
`host-net`, or env. Even if the code wanted to exfiltrate the key, there is no
import through which it could. The guarantee is enforced by what the component
*cannot reach*, not by what it promises.

## Build

```sh
pnpm --filter @refarm.dev/identity-provider-ref run build:wasm   # → dist/identity_provider.wasm
pnpm --filter @refarm.dev/identity-provider-ref run test         # native cargo tests
```

The reference crypto is the same `ed25519-dalek` the heartwood core uses; the
difference is entirely in *who holds the key*.
