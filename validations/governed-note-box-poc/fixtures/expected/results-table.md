# Governed Note Box PoC Results Table

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

| Criterion | Observed result | Gate | Evidence |
| --- | --- | --- | --- |
| Intake stays controlled | 3 synthetic notes ingested | pass | `intake-snapshot.json` |
| Metadata is preserved | 3 metadata records with body hashes | pass | `metadata-index.json` |
| Lab evidence is available | 4 links and 6 tags indexed | pass | `lab-snapshot.json` |
| Drafts stay unpublished | 1 draft withheld from publication | pass | `publication-snapshot.json` |
| Human review remains explicit | review required before publish | watch | `publication-preflight.json`, `human-review.md` |

## Claim Boundary

Use this table to describe the controlled synthetic note workflow. Do not use it to claim real vault integration, complete publication workflow, or ownership of downstream vault UX by Refarm.
