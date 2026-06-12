# Governed Note Box PoC Annex

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Metadata is preserved | `metadata-index.json` |
| Drafts stay out of publication | `publication-snapshot.json`, `publication-preflight.json` |
| Lab consumers have graph and metrics | `lab-snapshot.json` |
| Human review remains explicit | `publication-preflight.json`, `human-review.md` |
| Pilot decision is measurable | `scorecard.json` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
| metadataPreservation | 5 | 0.25 | Metadata index contains hash, tags, links, status, and dates. |
| publicationHygiene | 5 | 0.25 | Publication snapshot excludes draft notes. |
| labSnapshot | 5 | 0.2 | Lab snapshot exposes graph and metric data. |
| humanReview | 4 | 0.15 | Publication preflight requires human review. |
| localOnlyOperation | 5 | 0.15 | Preflight records no external service dependency. |

## Reader Path

1. Read `scenario.md` for the workflow question.
2. Inspect `publication-preflight.json` for readiness and warnings.
3. Inspect `scorecard.json` for thresholds and limits.
4. Use `task-artefacts.json` to verify hashes and provenance.
