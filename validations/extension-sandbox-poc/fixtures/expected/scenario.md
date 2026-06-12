# Extension Sandbox PoC Scenario

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

## Problem

A local host needs to accept extensions without letting optional code silently expand its authority. The scenario asks whether the host can verify manifests, enforce declared capability grants, record lifecycle evidence, and choose a safe outcome when an extension is denied or fails.

## Actors

- Operator: reviews capability grants and promotion decisions.
- Host: validates manifests and executes the synthetic lifecycle.
- Extension: requests capabilities and reports lifecycle events.

## Decision Points

1. A benign extension requests only granted capabilities and should complete.
2. A denied extension requests `network:v1` and should be blocked.
3. A failing extension should be isolated in warn+continue mode.
4. The same failing extension should abort the flow in fail-fast mode.

## Outcome

The synthetic run evaluated 2 policy modes and 6 plugin-policy combinations. The recommended strict host status is `aborted` and human review remains required before expanding capability grants.
