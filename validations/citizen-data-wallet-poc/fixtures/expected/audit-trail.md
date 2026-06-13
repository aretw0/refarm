# Citizen Data Wallet PoC Audit Trail

Scope: synthetic local validation only. No real personal, institutional, or secret data is used.

| Step | Input | Output | Verification |
| --- | --- | --- | --- |
| Identity | Synthetic holder id | identity.json | Local public key is present |
| Attributes | Synthetic issuer and four attributes | authority-attributes.json | Attributes are scoped to the fictitious holder |
| Request | Synthetic service need | service-request.json | Purpose, expiration, and requested attributes are explicit |
| Authorization | Request + holder key | authorization-receipt.json | Signature verifies against the canonical payload |
| Presentation | Authorization scope + attributes | selective-presentation.json | Only 2 of 4 attributes are disclosed |
| Tamper check | Modified authorization payload | no artifact | Signature verification fails |
| Revocation | Active authorization | revocation-event.json | Status changes from active to revoked |

## Metrics

- Attributes available: 4
- Attributes requested: 2
- Attributes presented: 2
- Authorization status before revocation: active
- Authorization status after revocation: revoked
- Tamper verification result: false
