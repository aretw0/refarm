# Extension Sandbox PoC Report

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

| Policy | Plugin | Outcome | Missing capabilities | Lifecycle events |
| --- | --- | --- | --- | ---: |
| warn+continue | @example/benign-extension | completed | none | 3 |
| warn+continue | @example/denied-extension | blocked-warn-continue | network:v1 | 0 |
| warn+continue | @example/failing-extension | failed-isolated | none | 2 |
| fail-fast | @example/benign-extension | completed | none | 3 |
| fail-fast | @example/denied-extension | blocked-fail-fast | network:v1 | 0 |
| fail-fast | @example/failing-extension | failed-aborted | none | 2 |

## Checks

- Benign extension completed: true
- Denied extension blocked: true
- Warn+continue survives isolated failure: true
- Fail-fast aborts on failure: true
- Lifecycle events recorded: 10
