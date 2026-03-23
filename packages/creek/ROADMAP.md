# Creek (O Riacho) - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Telemetry Foundations
**Scope**: Establish the core telemetry event stream and pulse monitoring.  
**Depends on**: `tractor` (TelemetryBus)

### SDD (Spec Driven)
- [ ] Spec: `refarm-creek.wit` interface stabilization.
- [ ] Spec: Circular buffer design for high-throughput events.
- [ ] Spec: System health record definitions (CPU, Memory, Plugin Latency).

### BDD (Behaviour Driven)
- [ ] Integration: `Creek` correctly subscribes to `TelemetryBus` events.
- [ ] Integration: Real-time pulse data visible in `Studio` telemetry view.
- [ ] Integration: Performance metrics captured for 10+ concurrent plugins.

### TDD (Test Driven)
- [ ] Unit: Circular buffer overflow and wrapping tests.
- [ ] Unit: Event filtering logic (level, source).
- [ ] Coverage: ≥80%

### DDD (Domain Implementation)
- [ ] Domain: `Creek` core stream logic.
- [ ] Infra: Integration with native `Tractor` event loop.
- [ ] Infra: Studio telemetry provider implementation.

---

## v0.2.0 - Aggregation & Alerting
**Scope**: Deep observability and proactive failure detection.

- [ ] Implementation of **Log Aggregation**: Unifying logs from all active WASM plugins into a single, searchable stream.
- [ ] **Pulse Alerting**: Signaling errors or performance degradations in real-time.
- [ ] Persistence of critical telemetry snapshots to the Sovereign Graph.

---

## Notes
- See [packages/creek/README.md](./README.md) for initial WIT draft.
- Inspired by real-time monitoring systems like Prometheus but optimized for local-first execution.
