# ADR-079: Credentials Verification Policy

**Status**: Proposed
**Date**: 2026-07-01
**Authors**: Arthur Silva, Claude
**Related**: ADR-074 (Remote Workspace Control Plane — "policy precedes execution"),
`specs/features/2026-06-30-credentials-contract-v1.md` (`credentials:v1`),
`specs/features/2026-07-01-credentials-verify-policy-revocation.md` (the concrete surface),
ADR-064 (Credential Error Enrichment Contract), ADR-076 (Silo storage/identity closure),
`packages/credentials-contract-v1`, consumer pressure: vault-seed headspace VC agent

---

## Context

`credentials:v1` ships `verify(input: VerifiableCredential | VerifiablePresentation)` today. It checks
the **signature** (issuer/holder Ed25519 over the canonicalized claim) and structural validity, and
returns a `CredentialVerificationResult`. It takes **only the credential** — there is no notion of
*whose* signatures to trust, whether the credential is **revoked**, whether it is **within its validity
window**, or whether it satisfies **claim/holder constraints**.

The first real consumer (the vault-seed headspace acting as a **verifier**) cannot answer "should I
accept this?" from a signature check alone. It needs a trust decision. The naive fix is a bespoke
`verify(input, trustedIssuers[])`. That is a dead end: the next requirement (revocation) forces another
parameter, then validity, then claim constraints — a widening ad-hoc signature. It also duplicates, in
the credentials layer, the "policy precedes execution" model ADR-074 already established for the control
plane and Scarecrow already embodies for observation/policy.

A **trust list is not a distinct feature — it is the simplest declarative policy.** The right primitive
is a policy-shaped verify where the trust list is one field.

## Decision

`credentials:v1` verification is evaluated against a **declarative `CredentialVerificationPolicy`**:

```
verify(input, policy?: CredentialVerificationPolicy): Promise<CredentialVerificationResult>
```

`CredentialVerificationPolicy` (all fields optional; absent = not enforced, preserving today's
signature-only behavior when no policy is passed — forward-safe):

- `trustedIssuers?: string[]` — issuer DIDs the verifier accepts. The **trust list** lives here.
- `trustSelf?: boolean` — when true, the verifier also accepts credentials whose issuer is the verifier's
  **own owner DID, resolved dynamically** from the composed identity provider at verify time. Survives key
  rotation and needs no hardcoded DID, so self-issued credentials verify without seeding a static entry.
- `trustRegistry?: TrustRegistryRef` — a resolvable source of trusted issuers (future; superset of the
  static list).
- `revocation?: "ignore" | "required"` — when `required`, the credential's status must resolve to
  not-revoked (mechanism per the companion feature).
- `validity?: "ignore" | "required"` — enforce `validFrom` / `validUntil`.
- `requiredClaims?: ClaimConstraint[]` — the credential must carry claims matching these constraints.
- `holderBinding?: boolean` — for a presentation, the holder must be the credential subject.

The result reports **per-check outcomes** (`signature`, `issuerTrusted`, `notRevoked`, `withinValidity`,
`claimsSatisfied`, `holderBound`) so a failure is legible, not a boolean. This composes with ADR-064's
error enrichment for the failing check.

**Config is the argument.** `CredentialVerificationPolicy` is plain data with no behavior, so a
consumer's declarative policy config (e.g. a vault's `vault.config.json`) is *structurally the policy* and
is passed straight into `verify` with **no translation layer**. Consumers author trust as configuration;
the contract evaluates it.

**What this ADR does *not* decide**: the revocation/status *mechanism* (status list vs referenced
endpoint) — that is the companion feature's decision. This ADR fixes the *shape*: verification is
policy-driven, and trust/`trustSelf`/revocation/validity/claims are policy fields, not verify parameters.

## Consequences

- **Forward-safe adoption.** No policy → signature-only (today's behavior). Consumers opt into strictness
  incrementally; existing callers and the conformance keep passing.
- **One primitive that grows.** Trust list, revocation, validity, and claim constraints are policy fields,
  not new methods — the surface stays stable as requirements accumulate.
- **Doctrine alignment.** Verification "policy precedes acceptance" mirrors ADR-074 and Scarecrow; policy
  is data, evaluated deterministically, and can be authored/audited outside code.
- **Consumer wins.** vault-seed ships a default policy as product config (a trust list to start) and
  subverts/extends it without touching the contract.
- **Cost.** The reference provider and conformance grow to evaluate policy fields; the revocation field is
  inert until the companion mechanism lands. `CredentialVerificationResult` gains per-check structure
  (additive).
