# Citizen Data Wallet PoC Results Table

Scope: synthetic local validation only. No real personal, institutional, or secret data is used.

| Criterion | Observed result | Gate | Evidence |
| --- | --- | --- | --- |
| Request scope is explicit | 2 requested attributes | pass | `service-request.json` |
| Disclosure is minimized | 2 of 4 attributes presented | pass | `selective-presentation.json` |
| Authorization is signed | signature verifies against canonical payload | pass | `authorization-receipt.json` |
| Revocation changes usability | status moves from active to revoked | pass | `revocation-event.json` |
| Standards and legal claims stay bounded | interoperability and compliance remain outside this proof | watch | `risk-and-standards-matrix.json`, `limits.md` |

## Claim Boundary

Use this table to describe a reviewable synthetic authorization journey. Do not use it to claim wallet interoperability, LGPD compliance, production UX, or public-service integration.
