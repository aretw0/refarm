# Refarm Telemetry Runbook (v1)

Operational response guide for `refarm telemetry` signals.

## Goal

Provide deterministic first-response actions when telemetry diagnostics appear,
so teams can act quickly without debating semantics during incidents.

## Canonical diagnostics (v1)

### Saturation

- `saturation:queue`
  - Meaning: queue depth exceeded configured threshold.
  - First checks:
    1. `refarm telemetry --json`
    2. `curl -s http://127.0.0.1:42001/efforts/summary`
    3. `npm run farm:status`
  - First action:
    - Reduce incoming task burst or split workload; verify workers are alive.

- `saturation:inflight`
  - Meaning: concurrent in-flight efforts exceeded threshold.
  - First checks:
    1. `refarm telemetry --json`
    2. inspect active efforts/log tails in `.refarm/task-logs/`
  - First action:
    - Reduce parallelism or isolate failing/slow tasks.

### Reliability

- `reliability:failures-present`
  - Meaning: there are historical failures in snapshot totals.
  - First checks:
    1. `refarm telemetry --json`
    2. inspect `.refarm/task-results/*.json`
  - First action:
    - Investigate root cause before retry loops; this is informational by default.

- `reliability:failures-recent`
  - Meaning: rolling window includes failed efforts.
  - First checks:
    1. `refarm telemetry --json --window-minutes 30`
    2. inspect latest task logs and provider reachability
  - First action:
    - Identify common failure signature and apply scoped fix.

- `reliability:failure-rate`
  - Meaning: rolling-window failure-rate exceeded threshold.
  - First checks:
    1. `refarm telemetry --json --strict-on reliability:failure-rate`
    2. provider and farmhand status (`npm run farm:status`)
  - First action:
    - Treat as gate-breaking reliability incident; stop promotions until stable.

## Recommended gate posture

For CI default gate, enforce only high-signal diagnostics:

```bash
npm run refarm:telemetry:gate:ci
```

Equivalent strict filter:

```bash
npm run refarm:telemetry:gate -- --strict-on saturation:queue,saturation:inflight,reliability:failure-rate
```

Use strict-all only when actively hardening policy:

```bash
npm run refarm:telemetry:gate:strict-all
```

## Artifact capture for trend analysis

Persist telemetry gate output per run:

```bash
npm run refarm:telemetry:gate -- --out .artifacts/telemetry/gate-latest.json
```

This supports medium-term threshold calibration from real history.
