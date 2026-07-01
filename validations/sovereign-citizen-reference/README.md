# Sovereign Citizen Reference

Sanitized T2 reference proof for `identity:v1` + `credentials:v1`:

- real Heartwood-backed Ed25519 signing through `@refarm.dev/identity-heartwood`;
- verifiable credential issue and verify through `@refarm.dev/credentials-contract-v1`;
- verifiable presentation signing and verification;
- holder wallet store/list round-trip through `storage:v1`.

The proof intentionally publishes only redacted, deterministic evidence. It does
not claim legal, W3C VC, OpenID4VP, issuer-trust, or production wallet UX
readiness.

Run:

```bash
pnpm run sovereign-citizen:reference:test
```
