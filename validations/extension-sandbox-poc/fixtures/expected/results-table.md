# Extension Sandbox PoC Results Table

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

| Criterion | Observed result | Gate | Evidence |
| --- | --- | --- | --- |
| Denied capabilities are explicit | 2 denied capability observations | pass | `policy-decision.json` |
| Failure handling is observable | 1 isolated failure in warn+continue mode | pass | `sandbox-report.json` |
| Lifecycle trace is recorded | 10 lifecycle events | pass | `sandbox-report.md` |
| Strict policy aborts unsafe flow | strict host status is `aborted` | pass | `policy-decision.json` |
| Real execution claim stays bounded | real WASM remains adjacent validation | watch | `runtime-evidence.json`, `limits.md` |
| Coding-agent authority stays bounded | unreviewed network remains denied and promotion requires review | pass | `coding-agent-evidence.json`, `policy-decision.json` |
| Coding-agent smoke remains proposal-only | protected surfaces are untouched and patch is review-only | pass | `coding-agent-smoke.json` |

## Claim Boundary

Use this table to describe measured synthetic policy behavior. Do not use it to claim production plugin governance, complete isolation, or real WASM execution inside the synthetic sandbox report.
