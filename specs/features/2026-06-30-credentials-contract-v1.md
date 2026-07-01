# Spec: Credentials Contract v1 (`credentials:v1`) — Verifiable Credentials & Data Wallet

**Status:** IMPLEMENTED — first T2 package slice landed; promotion remains proof-gated
**Authors:** Arthur Silva, Claude
**Date:** 2026-06-30
**Related:** `packages/identity-contract-v1` (`identity:v1` — keypair sign/verify, composed here),
`packages/storage-contract-v1` (`storage:v1` — wallet persistence), `packages/records-contract-v1`
(`records:v1` — boundary note below), `packages/README-CAPABILITIES.md`, W3C Verifiable Credentials
Data Model, ADR-010 (JSON-LD evolution)

---

## Context & Motivation

A sovereign citizen needs more than a keypair: they need to **hold verifiable claims about
themselves** and **present them** without a central authority — a data wallet. `identity:v1` provides
the keypair (`create`/`sign`/`verify`/`get`); there is no layer that issues, holds, presents, or
verifies **Verifiable Credentials** (W3C VC). The broad search confirms no VC/DID/wallet block
exists.

This is a genuinely reusable ecosystem primitive (any sovereign-data surface needs it), not a single
consumer's feature, so it earns its own contract — thin, composing `identity:v1` for proofs and
`storage:v1` for the wallet, aligned to the W3C VC data model so the foundation does not need an
obvious breaking change.

### Boundary vs `records:v1` (keeping the names meaningful)

A **credential** answers *"who attests this claim about a subject, and can I cryptographically verify
it?"* — it carries an issuer and a `proof`. A **record** answers *"what does this knowledge mean,
structurally?"* — no inherent attestation. They compose (a record may reference a credential) but do
not merge: `credentials:v1` owns issuance/trust/proof; `records:v1` owns the knowledge envelope.

### Prerequisite: real `identity:v1` signing (heartwood-backed) — ship first

A verifiable credential is only verifiable if its `proof` is a **real** signature. `credentials:v1`
composes `identity:v1` for `sign`/`verify`, but `@refarm.dev/identity-nostr` currently returns
**placeholder** keypair/signature values (pending `nostr-tools`). A VC demo on stubbed signatures
verifies nothing — the differentiator dies.

`@refarm.dev/heartwood` already performs **real Ed25519** `generateKeypair`/`sign` (it backs `silo`).
The shortest path is to back an `identity:v1` provider with heartwood so signing is real now, instead
of waiting on `nostr-tools`. **Batch order: (1) real `identity:v1` signing (heartwood-backed) →
(2) `credentials:v1` on top.** That slice now exists as `@refarm.dev/identity-heartwood` plus
`@refarm.dev/credentials-contract-v1`. Because `proof.type` is open, a later
OPAQUE/Sentinel/hardware-backed signature replaces the scheme without an envelope break.

### Confirmed decisions

| Decision | Choice | Reason |
|---|---|---|
| Form | `credentials:v1` capability contract over `identity:v1` | Refarm idiom; reusable by any sovereign-data surface. |
| Data model | W3C VC: `VerifiableCredential` + `VerifiablePresentation`, JSON-LD `@context` | Standard, interoperable, vocabulary-as-data. |
| Roles | issuer / holder / verifier | The citizen is the holder (the wallet); issuer/verifier may be anyone. |
| Proofs | via `identity:v1.sign`/`verify` | No new crypto; the keypair already exists. |
| Wallet | holder storage via `storage:v1` | Persistence is not re-implemented. |
| Trust | issuer trust is consumer policy, not baked in | Trust registries/authorities stay downstream. |

### First consumer is Refarm

Per the dogfood gate, the first consumer is Refarm itself: a sovereign profile self-issues and holds a
credential, then verifies it, using `identity-nostr` (or the in-memory provider) under `identity:v1`.

---

## 1. Contract interface (`packages/credentials-contract-v1/src/types.ts`)

```ts
export const CREDENTIALS_CAPABILITY = "credentials:v1" as const;

/** W3C-aligned. Unknown fields preserved on read/write (forward-safety). */
export interface VerifiableCredential {
  "@context": string | string[];
  type: string[];                          // ["VerifiableCredential", <type>]
  issuer: string;                          // issuer identity id / DID-like ref
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: Record<string, unknown> & { id?: string };
  proof?: CredentialProof;                 // absent until issued/signed
  [extra: string]: unknown;
}

export interface CredentialProof {
  type: string;                            // e.g. "identity:v1" proof
  created: string;
  verificationMethod: string;              // issuer publicKey ref
  signature: string;                       // identity:v1.sign output
}

export interface VerifiablePresentation {
  "@context": string | string[];
  type: string[];                          // ["VerifiablePresentation"]
  holder: string;                          // holder identity id
  verifiableCredential: VerifiableCredential[];
  proof?: CredentialProof;                 // holder's signature over the presentation
  [extra: string]: unknown;
}

export interface CredentialsProvider {
  readonly pluginId: string;
  readonly capability: typeof CREDENTIALS_CAPABILITY;

  /** Issuer: sign a credential with the issuer identity (identity:v1.sign). */
  issue(credential: VerifiableCredential, issuerIdentityId: string): Promise<VerifiableCredential>;

  /** Verifier: check proof + (optional) expiry. Trust of the issuer is the caller's policy. */
  verify(input: VerifiableCredential | VerifiablePresentation): Promise<{
    valid: boolean;
    issuer?: string;
    holder?: string;
    failures: string[];
  }>;

  /** Holder: bundle selected credentials into a presentation and sign it. */
  present(credentials: VerifiableCredential[], holderIdentityId: string): Promise<VerifiablePresentation>;

  // Wallet (holder store, backed by storage:v1):
  store(credential: VerifiableCredential): Promise<{ id: string }>;
  list(filter?: { type?: string; issuer?: string }): Promise<VerifiableCredential[]>;
  remove(id: string): Promise<{ removed: boolean }>;
}
```

`issue`/`verify`/`present` call `identity:v1` for signatures; `store`/`list`/`remove` are the wallet
over `storage:v1`. The contract owns the envelope + the roles, not the crypto or the storage backend.

## 2. Reference implementation + conformance

- `packages/credentials-contract-v1/src/reference.ts`: a provider composing
  `identity:v1` and `storage:v1` providers; its conformance fixture uses the
  in-memory providers, while the T2 real-signing proof uses
  `@refarm.dev/identity-heartwood`.
- `runCredentialsV1Conformance(provider)`: a self-issued credential verifies `valid:true`; a tampered
  credential verifies `valid:false`; a presentation with a holder proof verifies; expired credentials
  fail; the wallet round-trips store/list/remove; unknown fields survive a round-trip.

## 3. Forward compatibility

- W3C VC `@context`/`type` mean credential types are **data**, extensible without a contract change.
- `schemaVersion`-style evolution via `@context` versioning + preserve-unknown (ADR-010 / ADR-077
  lesson): an older verifier ignores unknown fields rather than failing.
- Proof `type` is open, so a future proof suite (e.g. an OPAQUE/Sentinel-backed signature from
  `silo`/`heartwood`) drops in without breaking the envelope.

## 4. Boundary

Refarm owns: the VC/VP envelope, the issuer/holder/verifier roles, conformance, the reference
provider composing `identity:v1` + `storage:v1`.

Consumer surfaces own: the wallet UX, which credentials to request/show, presentation flows.

Private downstream proofs own: specific credential types/schemas, issuer authorities, and trust
registries (who is an accepted issuer). The contract never bakes in a trust list.

## 5. Verification

1. `runCredentialsV1Conformance` over the reference provider;
2. tamper test (mutated subject ⇒ `valid:false`);
3. presentation verify (holder proof over bundled credentials);
4. expiry test; wallet store/list/remove round-trip;
5. forward-safety: unknown fields / extended `@context` verify without loss.

## Non-Goals

- No crypto implementation (composed from `identity:v1`); no storage backend (from `storage:v1`).
- No issuer trust registry or authority list in the contract.
- No domain credential schemas or vocabulary — those are downstream/private.
- No revocation registry in v1 (additive later; the envelope leaves room via `@context`).
