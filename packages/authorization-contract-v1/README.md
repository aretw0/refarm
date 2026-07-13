# @refarm.dev/authorization-contract-v1

The **authorization:v1** capability contract — purpose-bound consent, selective attribute
presentation, and auditable revocation. It governs the *disclosure* of a citizen's data,
the sibling of `credentials:v1` (which proves a credential).

A holder authorizes a service to see a **named subset** of their attributes, **for** a
stated purpose, **within** a scope and expiry — signs that decision — and can **revoke** it
later, leaving an auditable trail. This is the citizen-wallet authorization journey as a
versioned, verifiable capability, so any surface or plugin drives it the same way.

## The journey (the `AuthorizationProvider` interface)

```
authorize(request)          → a signed AuthorizationReceipt (status: active)
present(receipt, attrs)     → a SelectivePresentation (only in-scope attributes)
verify(receipt, [present])  → checks: signature · not-expired · not-revoked · scope
revoke(receipt, reason?)    → a RevocationEvent + the receipt in revoked status
```

Invariants the contract guarantees (and the conformance suite proves):

- `authorize` carries the request's **purpose and scope**; the receipt is **signed**.
- `present` discloses **only** the authorized attributes — never leaks out-of-scope data.
- `verify` **detects a tampered payload** (signature fails), an **expired** authorization,
  and a **revoked** one.
- `revoke` records the **status transition** and makes the receipt **unusable** (present
  rejects).

## Design

Crypto-agnostic by construction: `ReferenceAuthorizationProvider` takes an injected
`AuthorizationSigner` (sign/verify over the canonical JSON) and clock, so it runs the same
in a test, a CLI, or a sandboxed WASM plugin. A deployment injects an Ed25519 signer
(`node:crypto`) or a WASM signer; the in-memory fixture injects a deterministic,
tamper-sensitive stub so the whole journey runs offline and reproducibly.

The shapes mirror the W3C/EUDI vocabulary (purpose, scope, selective disclosure, status)
**in spirit, without claiming conformance** — a deployment maps them to OpenID4VP / VC as
a later step.

## Usage

```ts
import {
  createInMemoryAuthorizationProviderFixture,
} from "@refarm.dev/authorization-contract-v1";

const { provider } = createInMemoryAuthorizationProviderFixture();

const receipt = await provider.authorize({
  id: "req-1", requester: "service-x", subject: "citizen-1",
  purpose: "check eligibility", requestedAttributes: ["faixa_etaria", "vinculo"],
  expiresAt: "2026-02-01T00:00:00.000Z",
});
const presentation = await provider.present(receipt, attributeSet); // only in-scope
const { event, receipt: revoked } = await provider.revoke(receipt);  // auditable
```

## Conformance

`runAuthorizationV1Conformance(provider)` runs the full-journey suite against any provider.
Run with `pnpm run test:conformance`.
