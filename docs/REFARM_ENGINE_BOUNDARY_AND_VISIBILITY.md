# Refarm Engine Boundary & Visibility Guide

This document canonizes two long-term decisions:

1. **Where code should live** (`Rust` vs `TypeScript` vs `Astro`).
2. **What must always be visible** to avoid blind operation near resource/perf ceilings.

The mindset is scientific: measure first, optimize second, and keep every critical
runtime pressure observable.

## 1) Runtime boundary model

### Rust (authoritative data plane)
Use Rust for hot paths and reliability-critical execution:

- sidecars/daemons with sustained concurrency;
- CRDT sync internals and persistence hot loops;
- streaming ingestion/parsing where latency and memory are sensitive;
- trust/security enforcement that must be deterministic and fail-closed;
- high-volume state transforms.

### TypeScript/Node (control plane + UX iteration)
Use TS for host orchestration and product velocity:

- CLI UX, command composition, and interaction flow;
- context assembly, prompt orchestration, and workflow glue;
- thin adapters around stable backend contracts;
- fast iteration surfaces and integrations.

### Astro (presentation layer)
Use Astro for web rendering and operator dashboards only:

- rich visualization of status/metrics/history;
- inspectability and onboarding experiences.

Do **not** place critical runtime loops in Astro.

---

## 2) Performance migration rule

Do not migrate by preference. Migrate by evidence.

Move TS -> Rust only when one or more are true:

- sustained p95/p99 latency violation;
- measurable CPU/RAM pressure in production loops;
- instability under concurrency spikes;
- inability to guarantee deterministic fail-closed semantics.

If no measured pain exists, keep it in TS for velocity.

---

## 3) Canonical visibility contract (minimum)

Refarm should always expose these pressure axes:

1. **Queue pressure**
   - queue depth
   - in-flight operations
2. **Outcome pressure**
   - failed effort count
   - retry/cancel pressure
3. **Latency pressure**
   - processing time percentiles (future extension)
4. **Resource pressure**
   - memory/CPU/disk snapshots (future extension)

Current canonical endpoint/commands:

- `GET /visibility` (farmhand sidecar; current pressure snapshot)
- `GET /visibility/window?minutes=<n>` (farmhand sidecar; rolling window)
- `refarm visibility --profile <conservative|balanced|throughput>` (host CLI)

This contract is intentionally lightweight and can be expanded while preserving shape.

---

## 4) Operational policy (scientist mode)

- Observe before acting.
- Treat warnings as signals, not noise.
- Keep thresholds explicit and versioned.
- Prefer small controlled interventions over broad speculative rewrites.

Recommended quick triage loop:

```bash
refarm visibility
npm run farm:status
refarm doctor
```

If pressure remains high, scope a micro-slice and validate with targeted tests before any larger migration.

---

## 5) Next extensions (backlog)

- Add latency percentiles to visibility payload.
- Add substrate adapters for unified tree/timeline (`session`, `crdt`, `git`).
- Export visibility snapshots as JSON artifacts for CI trend diffing.
- Add strict mode/policy gate so CI can fail when pressure exceeds profile thresholds.

This keeps Refarm from becoming blind as complexity grows.
