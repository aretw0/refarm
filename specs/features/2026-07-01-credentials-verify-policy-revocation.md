# Spec: Credentials `verify(input, policy)` + revocation

**Status:** Proposed — candidate, consumer-pressure gated
**Authors:** Arthur Silva, Claude
**Date:** 2026-07-01
**Related:** ADR-079 (Credentials Verification Policy — the decision this implements),
`specs/features/2026-06-30-credentials-contract-v1.md` (`credentials:v1`),
`packages/credentials-contract-v1` (contract + reference provider + conformance),
`packages/identity-contract-v1`, `packages/storage-contract-v1`, ADR-064 (credential error enrichment),
consumer: vault-seed headspace VC agent
(`docs/superpowers/specs/2026-07-01-credentials-vc-headspace-design.md` downstream)

---

## Context & motivation

Per ADR-079, `credentials:v1` verification becomes policy-driven. Today `verify(input)` is
signature-only; the first verifier consumer (vault-seed) needs trust + revocation + validity. This spec
defines the concrete surface and the **revocation mechanism** ADR-079 deferred.

## Surface

Extend `CredentialsProvider.verify` (backward-compatible — `policy` optional):

```
verify(
  input: VerifiableCredential | VerifiablePresentation,
  policy?: CredentialVerificationPolicy,
): Promise<CredentialVerificationResult>
```

`CredentialVerificationPolicy` — fields per ADR-079 (`trustedIssuers`, `revocation`, `validity`,
`requiredClaims`, `holderBinding`, future `trustRegistry`). Absent policy ⇒ signature-only (unchanged).

`CredentialVerificationResult` gains a structured `checks` map so failures are legible:

```
{
  verified: boolean,
  checks: {
    signature: CheckOutcome,
    issuerTrusted?: CheckOutcome,
    notRevoked?: CheckOutcome,
    withinValidity?: CheckOutcome,
    claimsSatisfied?: CheckOutcome,
    holderBound?: CheckOutcome,
  },
  // failing checks carry an ADR-064-enriched error
}
```

Only checks the policy requested appear (optional keys). `verified` is the AND of all present checks.

## Revocation mechanism (the deferred decision)

Adopt a **credential status list** as the v1 mechanism (simplest that composes with `storage:v1`, no new
network dependency):

- A credential MAY carry a `credentialStatus` reference (id + a status-list coordinate).
- The issuer maintains a **status list** — a compact, signed, append-only structure persisted via
  `storage:v1` (a bitstring/status entry per issued credential).
- When `policy.revocation === "required"`, `verify` resolves the referenced status and fails `notRevoked`
  if revoked (or if a required status cannot be resolved).
- A `revoke(credentialId, issuerIdentityId)` provider method flips the status entry and re-signs the list.

A referenced remote status endpoint is a **future** extension (the status ref is designed to allow it);
v1 keeps the list local + signed, resolvable offline — consistent with the sovereign posture.

## Conformance additions

`runCredentialsV1Conformance` grows policy cases (still deterministic, in-memory identities + storage):

1. **trust** — a VC from an issuer in `trustedIssuers` passes `issuerTrusted`; one outside fails it.
2. **validity** — an expired VC fails `withinValidity` under `validity: "required"`, passes when ignored.
3. **revocation** — issue → verify not-revoked → `revoke` → verify fails `notRevoked` under
   `revocation: "required"`.
4. **holder binding** — a presentation whose holder ≠ subject fails `holderBound` when required.
5. **forward-safe** — no policy ⇒ signature-only result identical to today.

## Consumer pressure & gate

Pressure: the vault-seed headspace verifier needs trust + revocation to answer "accept this?". This spec
is **proposed**; it becomes implemented when the reference provider + conformance land and a consumer
(vault-seed's round-trip, or refarm dogfood) proves it. Trust-policy was already named as the promotion
gate in the `credentials:v1` feature — this closes that gate.

## Out of scope

- Selective disclosure / ZK presentation (separate future spec).
- Hosted trust registries (`trustRegistry` field is reserved; static `trustedIssuers` first).
- Cross-issuer revocation aggregation.
