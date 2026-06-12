# Citizen Data Wallet PoC Annex

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Purpose and scope are explicit | `service-request.json`, `authorization-receipt.json` |
| Disclosure is minimized | `selective-presentation.json` |
| Integrity is testable | `authorization-receipt.json`, audit trail tamper check |
| Revocation is reviewable | `revocation-event.json`, `consent-decision.json` |
| Pilot decision is measurable | `scorecard.json` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
| purposeAndScope | 5 | 0.2 | Service request and receipt carry purpose, scope, and expiration. |
| selectiveDisclosure | 5 | 0.25 | Presentation exposes only requested attributes. |
| signatureIntegrity | 5 | 0.25 | Signature verifies and tampered payload fails verification. |
| revocationUsability | 5 | 0.2 | Revocation changes authorization status to unusable. |
| humanReview | 4 | 0.1 | Consent decision requires operator review. |

## Reader Path

1. Read `scenario.md` for the service journey.
2. Inspect `consent-decision.json` for the review point.
3. Inspect `scorecard.json` for thresholds and limits.
4. Use `task-artefacts.json` to verify hashes and provenance.
