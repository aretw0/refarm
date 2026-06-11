# Citizen Data Wallet PoC

This validation is a small, synthetic, local-only proof of a minimum citizen data
wallet flow.

It answers one question:

> Can a local wallet represent a granular holder decision with purpose,
> expiration, scope, selective disclosure, revocation, and a human-readable audit
> trail?

## Scope

The PoC uses only fictitious entities and attributes:

- holder: `cidadao-exemplo-001`
- issuer: `emissor-publico-sintetico`
- verifier: `servico-sintetico-beneficio`
- attributes: `nome_social`, `faixa_etaria`, `municipio`, `vinculo`

No real personal, institutional, or secret data is used.

## What It Demonstrates

- A service request declares purpose, expiration, requested attributes, and
  justification.
- A holder authorization signs the canonical authorization payload.
- A selective presentation discloses only requested attributes.
- Tampering with the authorization payload fails signature verification.
- A revocation event changes the authorization state from `active` to
  `revoked`.
- JSON artifacts and a Markdown audit trail are generated deterministically.

## What It Does Not Demonstrate

- Full EUDI wallet interoperability.
- Full W3C Verifiable Credentials or OpenID4VP/OpenID4VCI compliance.
- Production UX or accessibility.
- Multi-device sync.
- Integration with real public services, identity providers, or credential
  issuers.

The signature format is intentionally local and compact. It is inspired by
verifiable credential proof concepts, but it is not a standards conformance
claim. The Ed25519 private key used by the script is a committed synthetic test
key so fixtures stay deterministic; it must not be reused outside this PoC.

## Run

From the repository root:

```bash
pnpm run wallet:poc:test
```

To regenerate the expected synthetic artifacts:

```bash
pnpm run wallet:poc
```

## Success Criteria

- Authorization contains purpose, expiration, and scope.
- Selective presentation does not include attributes outside the request.
- Valid signature verification passes.
- Tampered payload verification fails.
- Revoked authorization is not usable.
- `fixtures/expected/audit-trail.md` is generated without real data.

## Artifacts

Expected artifacts live in `fixtures/expected/`:

- `identity.json`
- `authority-attributes.json`
- `service-request.json`
- `authorization-receipt.json`
- `selective-presentation.json`
- `revocation-event.json`
- `audit-trail.md`

## Next Steps

- Persist the receipt through a storage contract adapter.
- Map fields to W3C VC and OpenID4VP concepts without claiming conformance.
- Add a simple consent text review checklist.
- Add an accessibility checklist for a future receipt UI.
