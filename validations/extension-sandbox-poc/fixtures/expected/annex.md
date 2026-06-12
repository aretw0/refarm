# Extension Sandbox PoC Annex

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Manifest and capability boundaries are checked | `sandbox-report.json`, `policy-decision.json` |
| Denied capabilities remain reviewable | `policy-decision.json` denied plugin list |
| Failure mode changes are explicit | `sandbox-report.md` policy table |
| Pilot decision is measurable | `scorecard.json` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
| manifestPolicy | 5 | 0.25 | Denied extension records missing capabilities. |
| lifecycleEvidence | 5 | 0.2 | Lifecycle events are recorded for completed and failed paths. |
| failureIsolation | 5 | 0.2 | Warn+continue keeps the host running after isolated failure. |
| strictAbort | 5 | 0.2 | Fail-fast aborts on the failing extension path. |
| humanReview | 4 | 0.15 | Policy decision requires operator review. |

## Reader Path

1. Read `scenario.md` for the operational question.
2. Inspect `policy-decision.json` for the review decision.
3. Inspect `scorecard.json` for the gate and limits.
4. Use `task-artefacts.json` to verify hashes and provenance.
