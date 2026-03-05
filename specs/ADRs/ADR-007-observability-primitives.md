# ADR-007: Observability & Introspection Primitives

**Status**: 📝 DRAFT (In Research)  
**Date**: 2026-03-05 (Target: v0.2.0 or v0.3.0)  
**Deciders**: Core Team  
**Context**: [Critical Validations - Observability](../../docs/research/critical-validations.md#observabilidade--introspecção-de-estado)

---

## Context & Problem Statement

Refarm is a meta-platform where multiple independent components (kernel, plugins, primitives) execute simultaneously. Each has:

- Its own internal state
- Its own traces and metrics
- Its own telemetry mechanisms

**Core Challenge**: How do we establish **cohesive observability primitives** that enable:

- Real-time monitoring of the entire system
- Deep introspection of individual plugin state
- Emergent composition of dashboards
- Universal event listening (including events about events)
- Debugging without tight coupling
- **Self-healing**: Automatic recovery from errors
- **Opt-in telemetry**: Community-driven error reporting (privacy-first)

**Meta Philosophy**: Observability itself should be composable and emergent. The system should be **self-aware** and **self-healing**.

---

## Decision Drivers (To be evaluated)

- **Developer Experience**: Easy to instrument, easy to consume
- **Performance**: Minimal overhead on critical paths
- **Security**: Plugins can't escape sandbox via observability
- **Composability**: Meta-observability (observe the observers)
- **Standards**: Leverage existing standards where possible
- **Independence**: Components work standalone even without observability
- **Self-Healing**: System recovers from errors automatically
- **Privacy**: Telemetry is opt-in, anonymized, transparent
- **Pluggability**: Users can connect their own monitoring tools

---

## Proposed Decision

**Architectural Choice**: **Hybrid Approach — Core Primitives + Pluggable Implementations**

### Core Primitives (Kernel Built-in)

The kernel provides minimal, non-opinionated observability primitives:

- **Event Emission**: `kernel.emit(event)` — Structured event publishing
- **Event Subscription**: `kernel.subscribe(pattern, callback)` — Pattern-based listening
- **State Introspection**: `component.getState()` — Query internal state
- **Dump Generation**: `kernel.captureDump(context)` — Capture state snapshots
- **Error Boundaries**: Automatic error isolation and recovery (always active)

**Core Philosophy**: These primitives are **always available** but **never impose implementation**. They define the "what" (interface), not the "how" (destination).

### Pluggable Implementations (Optional)

Observability **implementations** are **plugins**, not core:

```
[Kernel SDK] → [Observer Plugins]
                   ├─ RefarmTelemetry (official, opt-in, default: OFF)
                   ├─ SentryObserver (third-party)
                   ├─ GrafanaObserver (third-party)
                   ├─ StudioDevTools (development only)
                   └─ CustomObserver (user-defined)
```

**Benefits**:

- ✅ **Kernel stays lean**: No telemetry opinions baked in
- ✅ **Privacy-first**: Telemetry is opt-in, not opt-out
- ✅ **User choice**: Connect any monitoring tool (Sentry, Grafana, custom)
- ✅ **Self-healing is core**: Error recovery happens regardless of observer plugins
- ✅ **Meta-composability**: Observers are plugins observing other plugins

### Rationale

**Why not make everything a plugin?**

- **Self-healing must be core**: System resilience is non-negotiable — can't be unplugged
- **Primitives enable ecosystem**: Without `emit()`/`subscribe()` built-in, plugins can't observe
- **Meta-language philosophy**: Core enables emergent composition — plugins build on primitives

**Why not bake telemetry into kernel?**

- **Privacy**: Most users won't want telemetry — making it opt-in by default respects autonomy
- **Flexibility**: Users may prefer Sentry, Datadog, or custom solutions over official telemetry
- **Separation of concerns**: Kernel does orchestration; observers do monitoring

### Implementation Status

**Decided**:

- ✅ Hybrid architecture (primitives + plugins)
- ✅ Self-healing is core, always active
- ✅ Telemetry is optional plugin (default: OFF)

**To Be Decided** (see "Questions to Answer" below):

- Exact API surface for primitives (`emit()`, `subscribe()` signatures)
- Event formats (JSON-LD vs OpenTelemetry vs custom)
- Performance overhead strategies (sampling, buffering)
- Storage persistence (OPFS, memory-only, export)

---

## Options to Consider

*(To be researched and documented)*

### Option 1: OpenTelemetry-based

**Pros**:

- Industry standard
- Rich ecosystem (collectors, exporters, visualizers)
- Supports traces, metrics, logs

**Cons**:

- Potentially heavyweight for browser/WASM context
- May not fit "meta" philosophy cleanly
- Designed for distributed systems, not sandboxed plugins

---

### Option 2: Custom JSON-LD Event Stream

**Pros**:

- Aligns with Refarm's JSON-LD core
- Fully composable (events are data)
- Can be stored/queried like any other data
- Naturally meta (events about events)

**Cons**:

- Custom implementation needed
- No existing tooling
- Need to define schemas/contracts

---

### Option 3: Chrome DevTools Protocol Subset

**Pros**:

- Familiar to web developers
- Rich introspection capabilities
- Works well with Workers

**Cons**:

- Chrome-specific (though other browsers support subsets)
- Complex protocol
- Not designed for plugin sandboxing

---

### Option 4: Hybrid Approach

Combine:

- OpenTelemetry for traces/metrics (external observability)
- Custom event stream for internal state (composability)
- Chrome DevTools for debugging (development only)

---

## Questions to Answer (ADR Content)

### 1. Telemetry Interface

**Q**: What primitives does the SDK expose?

Options:

- `emit(event)` — Generic event emission
- `span(name, fn)` — OpenTelemetry-style spans
- `metric(name, value)` — Counters, gauges, histograms
- `log(level, message)` — Structured logging
- `subscribe(pattern, callback)` — Event listening

**Decision**: TBD

---

### 2. Granularity

**Q**: What level of detail do we capture?

- Kernel operations (storage, sync, network)
- Plugin lifecycle (load, init, execute, unload)
- Function-level traces (every SDK call)
- User interactions (clicks, navigation)
- Performance metrics (CPU, memory, I/O)

**Decision**: TBD (likely configurable)

---

### 3. Performance Overhead

**Q**: How do we minimize impact?

Options:

- Sampling (only capture X% of events)
- Buffering (batch events before emit)
- Async processing (Worker for telemetry)
- Feature flags (disable in production?)

**Decision**: TBD

---

### 4. Storage & Persistence

**Q**: Where do traces/events live?

Options:

- Memory only (ephemeral, low overhead)
- OPFS (persistent, queryable, storage cost)
- Export to external system (backend, file download)
- Hybrid (recent in memory, old in OPFS)

**Decision**: TBD

---

### 5. Real-time Transmission

**Q**: How does state flow to observers?

Options:

- Worker messaging (`postMessage`)
- SharedArrayBuffer (lock-free queues)
- BroadcastChannel (cross-context)
- WebSocket to Studio (dev mode)
- Polling (simple but inefficient)

**Decision**: TBD

---

### 6. Security & Sandboxing

**Q**: How do plugins observe without escaping sandbox?

Constraints:

- Plugins can emit events about their own state
- Plugins can subscribe to specific patterns (not all events)
- Kernel filters/validates all events
- No direct access to other plugins' internals

**Decision**: TBD (likely capability-based)

---

### 7. Standards & Formats

**Q**: What formats do we use?

Options:

- OpenTelemetry Protocol (OTLP)
- JSON-LD (aligned with Refarm core)
- CloudEvents (CNCF standard)
- Custom format optimized for Refarm

**Decision**: TBD

---

### 8. Self-Healing & Crash Recovery

**Q**: How does the system recover from fatal errors?

**Philosophy**: Refarm should **never crash** — it should recover gracefully and preserve state.

**Requirements**:

- Fatal errors don't terminate the entire system
- Affected component isolates and restarts
- State preserved via dump generation
- User notified of recovery action
- Option to continue from checkpoint

**Options**:

- Worker isolation (crash in Worker doesn't affect main thread)
- Error boundaries (React-style for component trees)
- Checkpoint/restore (periodic state snapshots)
- Graceful degradation (disable failing plugin, keep system running)

**Questions**:

1. What constitutes a "fatal" error?
2. How do we preserve state during recovery?
3. Where are dumps stored? (OPFS, memory, export?)
4. Can users manually trigger dumps?
5. How do we prevent cascading failures?

**Decision**: TBD

---

### 9. Telemetry Opt-In & Privacy

**Q**: How do we collect community telemetry while respecting privacy?

**Principles**:

- **Default: OFF** — Telemetry is opt-in, not opt-out
- **Transparent**: User knows exactly what data is collected
- **Anonymized**: Zero personally identifiable information (PII)
- **Minimal**: Only internals/errors, never user data
- **Consent required**: Explicit prompt before first send

**Data to Collect** (if enabled):

- ✅ Error stack traces (anonymized paths)
- ✅ Performance metrics (memory, CPU, operation counts)
- ✅ Browser/platform info (navigator.userAgent sanitized)
- ✅ Refarm version, plugin versions
- ❌ User data (messages, files, contacts, etc.)
- ❌ Identity (no user ID, IP, cookies)
- ❌ Usage patterns (what user does)

**Questions**:

1. Where is telemetry sent? (community server, GitHub, etc.)
2. How do we anonymize file paths? (hash? truncate?)
3. What's the consent UX? (banner? settings?)
4. Can users review data before send?
5. How do we handle offline telemetry? (queue? discard?)

**Decision**: TBD

---

### 10. Dump Generation & Analysis

**Q**: What happens when an error occurs?

**Workflow**:

1. Error caught by error boundary
2. System attempts recovery (restart component)
3. Dump generated (state snapshot + stack trace)
4. User notified: "Error recovered. Dump saved."
5. If telemetry ON: Ask to upload dump
6. If telemetry OFF: Dump stays local (for manual analysis)

**Dump Contents**:

- Timestamp
- Error type + message + stack trace
- System state (anonymized JSON-LD)
- Recent event log (last N operations)
- Plugin versions
- Performance metrics at crash time

**Storage**:

- Local: OPFS (user can review/export)
- Remote: Only if telemetry enabled + user consents

**Questions**:

1. How large can dumps get? (size limit?)
2. How long do we keep dumps? (auto-purge after 30 days?)
3. Can users export dumps manually?
4. What format? (JSON? Binary? Compressed?)

**Decision**: TBD

---

### 11. Provider Plugability

**Q**: Can users connect their own monitoring tools?

**Philosophy**: Observability implementation should be **pluggable** — primitives exposed, but destinations configurable.

**Use Cases**:

- User wants to send traces to Sentry
- User wants to visualize metrics in Grafana
- User wants to store logs in their own server
- User wants to integrate with their company's monitoring

**Architecture**:

```
[Kernel Observability Primitives] (emit events)
          ↓
[Observer Plugin Interface] (SDK)
          ↓
[User-chosen implementation]
  - Telemetry Plugin (official, opt-in)
  - Sentry Plugin
  - Custom logging plugin
  - Dev tools plugin (Studio)
  - No-op (disabled)
```

**SDK Interface** (proposed):

```typescript
// Plugins implement this interface
interface ObserverPlugin {
  onEvent(event: TelemetryEvent): void;
  onMetric(metric: Metric): void;
  onTrace(trace: Trace): void;
  onError(error: ErrorDump): void;
}
```

**Questions**:

1. How do observability plugins get loaded?
2. Can multiple observers run simultaneously?
3. Do observers run in separate Workers? (performance isolation)
4. How do we handle observer failures? (can't break system)

**Decision**: TBD (likely yes, via plugin architecture)

---

## Examples (To be designed)

### Kernel Event Example

```typescript
// Kernel emits structured events
kernel.emit({
  "@context": "https://refarm.dev/schema/telemetry",
  "@type": "StorageOperation",
  "operation": "write",
  "key": "user/profile",
  "timestamp": 1234567890,
  "duration_ms": 12,
  "success": true
});
```

### Plugin Introspection Example

```typescript
// Plugin exposes internal state
export function getState() {
  return {
    "@type": "PluginState",
    "status": "active",
    "messages_processed": 1234,
    "last_sync": "2026-03-05T10:00:00Z"
  };
}

// Studio can query
const state = await plugin.introspect();
```

### Dashboard Composition Example

```typescript
// Meta: Create dashboard from events
const dashboard = createDashboard({
  sources: [
    { plugin: "whatsapp", metric: "messages_processed" },
    { kernel: "storage", metric: "operations_per_sec" },
    { system: "memory", metric: "heap_used_mb" }
  ]
});

// Dashboards are themselves observable
dashboard.on("update", (data) => {
  console.log("Dashboard refreshed", data);
});
```

---

### Self-Healing Example

```typescript
// Error boundary catches plugin crash
try {
  await plugin.execute();
} catch (error) {
  console.error("Plugin crashed:", error);
  
  // 1. Generate dump
  const dump = await kernel.captureDump({
    error,
    context: "plugin_execution",
    pluginId: plugin.id,
    state: plugin.getState()
  });
  
  // 2. Save dump locally (OPFS)
  await kernel.storage.saveDump(dump);
  
  // 3. Attempt recovery
  const recovered = await kernel.recoverPlugin(plugin.id);
  
  if (recovered) {
    // 4. Notify user
    kernel.notify({
      type: "error_recovered",
      message: "Plugin recovered from error",
      severity: "warning",
      actions: [
        { label: "View Details", href: `/dumps/${dump.id}` },
        { label: "Report Issue", action: "upload_dump" }
      ]
    });
  } else {
    // Graceful degradation: disable plugin
    kernel.disablePlugin(plugin.id);
    kernel.notify({
      type: "plugin_disabled",
      message: "Plugin disabled due to errors",
      severity: "error"
    });
  }
}
```

---

### Telemetry Opt-In Example

```typescript
// Telemetry is opt-in by default (OFF)
const telemetryEnabled = await kernel.settings.get("telemetry_enabled"); // false

// First launch: show consent dialog
if (!telemetryEnabled) {
  const consent = await kernel.ui.showConsentDialog({
    title: "Help Improve Refarm",
    message: "Send anonymous error reports? (Opt-in, privacy-first)",
    collectsData: ["errors", "performance", "system_info"],
    neverCollects: ["user_data", "identity", "usage_patterns"]
  });
  await kernel.settings.set("telemetry_enabled", consent);
}

// User can toggle anytime in settings
await kernel.telemetry.enable();  // Starts capturing (if consented)
await kernel.telemetry.disable(); // Stops capturing
```

---

### Dump Export Example

```typescript
// Dumps are saved locally (OPFS), users can review/export
const dumps = await kernel.storage.listDumps();
// [{ id: "dump-123", timestamp: "...", error: "...", size: "12KB" }, ...]

// View specific dump
const dump = await kernel.storage.getDump("dump-123");
// { error: "...", stackTrace: "...", state: {...}, version: "..." }

// Export dump (downloads JSON file)
await kernel.storage.exportDump("dump-123"); 

// Upload to telemetry (if enabled and user confirms)
await kernel.telemetry.uploadDump(dump.id);
```

---

### Pluggable Observer Example

```typescript
// Users can plug their own monitoring tools
import { ObserverPlugin } from "@refarm/sdk";
import * as Sentry from "@sentry/browser";

export class SentryObserver implements ObserverPlugin {
  constructor(dsn: string) { Sentry.init({ dsn }); }
  
  onEvent(event: TelemetryEvent) { Sentry.addBreadcrumb({...}); }
  onMetric(metric: Metric) { Sentry.setMeasurement(metric.name, metric.value); }
  onTrace(trace: Trace) { const tx = Sentry.startTransaction({...}); tx.finish(); }
  onError(error: ErrorDump) { Sentry.captureException(new Error(error.message)); }
}

// Register observer plugin
await kernel.observers.register(new SentryObserver("https://..."));

// Multiple observers can coexist
await kernel.observers.register(new ConsoleObserver());
await kernel.observers.register(new GrafanaObserver());
```

---

## Decision Outcome

**Status**: 📝 DRAFT — Architectural direction chosen, implementation details TBD

**Chosen Option**: **Hybrid Approach** (Core Primitives + Pluggable Observers)

### What's Decided

✅ **Architecture**: Kernel provides primitives; observers are plugins
✅ **Self-healing**: Core feature, always active (not a plugin)
✅ **Telemetry**: Optional plugin, opt-in (default: OFF)
✅ **Privacy**: Anonymized, transparent, user-controlled
✅ **Pluggability**: Users can connect any monitoring tool (Sentry, Grafana, etc.)

### What's Still Open

🔄 **API Signatures**: Exact `emit()`, `subscribe()`, `dump()` interfaces
🔄 **Event Formats**: JSON-LD vs OpenTelemetry vs custom schema
🔄 **Performance Strategy**: Sampling rates, buffering, async processing
🔄 **Storage Layer**: OPFS persistence vs memory-only vs hybrid
🔄 **Real-time Transmission**: Worker messaging, SharedArrayBuffer, or BroadcastChannel

### Next Steps

1. Complete Pre-SDD validations (v0.1.0 milestone)
2. Implement storage + sync primitives (v0.1.0)
3. Return to this ADR during v0.2.0 or v0.3.0 planning
4. Prototype observer plugin interface
5. Benchmark performance overhead
6. Finalize API contracts

---

## Links

- [Roadmap: Backlog ADRs](../../roadmaps/MAIN.md#backlog-cross-cutting-concerns)
- [Critical Validations: Observability](../../docs/research/critical-validations.md#observabilidade--introspecção-de-estado)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [JSON-LD Specification](https://www.w3.org/TR/json-ld/)
- [CloudEvents Spec](https://cloudevents.io/)
- [Sentry Error Tracking](https://docs.sentry.io/)
- [Grafana Observability](https://grafana.com/docs/)
- [WebAssembly Error Handling](https://webassembly.github.io/spec/core/exec/runtime.html#errors)

---

**Notes**:

This is a **complex, cross-cutting concern** that affects:

- Kernel architecture
- Plugin SDK design
- Studio development experience
- Performance characteristics
- Security model
- User privacy and consent
- Error recovery strategies

It deserves dedicated research and careful decision-making after core primitives (storage, sync, identity) are stable.

**Key Insight**: Observability implementation should follow Refarm's philosophy — **primitives are exposed via SDK, but concrete implementations are pluggable**. This means:

1. **Kernel provides primitives**: `emit()`, `subscribe()`, `captureDump()`, etc.
2. **Official telemetry is optional**: A plugin that users can enable/disable
3. **Users can replace it**: Connect Sentry, Grafana, custom logging, etc.
4. **Self-healing is core**: Error recovery happens regardless of telemetry choice

**Architecture**:

```
[Kernel] (core primitives)
    ↓
[Observability SDK] (emit/subscribe/dump)
    ↓
[Observer Plugins] (pluggable)
    - RefarmTelemetry (official, opt-in, default: OFF)
    - SentryObserver (third-party)
    - GrafanaObserver (third-party)
    - ConsoleObserver (dev mode)
    - Custom implementations
```

**Timeline**: Research phase should start in **v0.2.0** sprint, decision by **v0.3.0**.
