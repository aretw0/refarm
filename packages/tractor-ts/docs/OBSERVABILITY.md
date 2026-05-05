# Observability & Diagnostics

Refarm Tractor uses a "Black Box Recorder" pattern designed to give you rich diagnostic context without compromising the privacy of Sovereign Data or degrading performance by writing huge strings to `stdout`.

## 1. Console Logs

By default, the engine favors silence. Console Logs are strictly for human-readable lifecycle events, errors, or anomalies.
- **Production (`info`, `warn`, `error`):** Only emits boot sequences, missing dependencies, or system-level crashes.
- **Development (`debug`):** Emits deeper traces when explicitly enabled (usually via configuring `logLevel` inside `Tractor.boot()`).

## 2. The Telemetry Ring Buffer

Even in production silence, Tractor observes all plugin interactions, storage mutations, and identity exchanges via an internal `EventEmitter`.

These events are pushed into the **Telemetry Ring Buffer**, an in-memory, bounded array (defaulting to the last 1000 events). This acts like an airplane's black box.

- It is purely volatile. It is never automatically stored to disk.
- It is highly performant. Events are shallow-cloned to prevent deep serialization costs during normal execution.
- It acts as the backbone for debugging broken plugins locally or in production.

## 3. Sovereign Diagnostic Export

If you need to investigate a failure or want to send a profile dump to a plugin developer, you can export the Telemetry Ring Buffer into a sanitized JSON document by triggering the `system:diagnostics:export` command via the `CommandHost`.

```javascript
const dump = await tractor.commands.execute("system:diagnostics:export");
console.log(dump.events); // The sanitized chronological list of the last 1000 events
```

For runtime descriptor revocation incidents, Tractor also exposes higher-level diagnostics:

```javascript
const summary = await tractor.commands.execute(
  "system:diagnostics:descriptor-revocation-summary",
  { pluginId: "@acme/plugin-a", limit: 200 }
);

const diagnostics = await tractor.commands.execute(
  "system:diagnostics:descriptor-revocation-alerts",
  { unavailableCriticalAt: 2, configDriftWarnAt: 1 }
);

console.log(summary.summary);
console.log(diagnostics.alerts);
```

For historical triage in CI/ops, generate the current snapshot, attempt baseline lookup from the previous successful run, and then compute delta:

```bash
npm run runtime-descriptor:revocation-report -- --input /path/to/telemetry-export.json
npm run runtime-descriptor:revocation-baseline -- \
  --current-report .artifacts/runtime-descriptor-revocation-report/summary.json \
  --reports-file .artifacts/runtime-descriptor-revocation-history/reports.txt
npm run runtime-descriptor:revocation-history -- \
  --reports-file .artifacts/runtime-descriptor-revocation-history/reports.txt \
  --out-dir .artifacts/runtime-descriptor-revocation-history
```

This generates:
- `.artifacts/runtime-descriptor-revocation-baseline/baseline.json`
- `.artifacts/runtime-descriptor-revocation-baseline/previous-summary.json` (when found)
- `.artifacts/runtime-descriptor-revocation-history/history.json`
- `.artifacts/runtime-descriptor-revocation-history/history.md`

### Sanitization Policy
The export process automatically protects user data by applying sanitization hooks to the JSON payload:
1. **Redaction:** Known sensitive keys (`secretKey`, `token`, `password`, `sas`, etc.) are replaced with `[REDACTED]`.
2. **Truncation:** Any string exceeding 500 characters is sliced with a formatting suffix `... [TRUNCATED]`.
3. **Binary Abstraction:** Buffers (`Uint8Array`) are summarized into labels like `[Uint8Array(2048)]`. Large arrays are reduced similarly.

## 4. Emitting Events from Custom Plugins

If you are developing a WASM plugin or custom host logic, anything you wish to be recorded should be emitted normally. The Ring Buffer will intercept it automatically.

```typescript
// Example from a host adapter
tractor.events.emit({
  event: 'my_adapter:action_started',
  durationMs: 45,
  payload: { path: '/tmp/foo' }
});
```
