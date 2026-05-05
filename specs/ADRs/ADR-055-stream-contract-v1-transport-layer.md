# ADR-055: stream-contract-v1 as Separate Transport Package Family

## Status

**Accepted**

## Context

ADR-054 introduced `StreamChunk` and `StreamSession` as generic host-owned CRDT
observation nodes. That ADR is intentionally silent on how external consumers
(CLI, browser UIs, WebSocket clients) receive those chunks — it specifies the
storage primitive, not the delivery mechanism.

Farmhand holds the CRDT in-process. Consumers outside that process need a framing
protocol: File (CLI polling), SSE (browser EventSource), or WebSocket (live TUI/UI).
Three options existed for where to put this transport layer:

1. **Embed in Farmhand** — write transport logic directly in `apps/farmhand/src/`.
2. **Extend effort-contract-v1** — add a `subscribe` API to the existing effort
   capability contract.
3. **Separate package family** — define `stream-contract-v1` as its own capability
   contract and ship each transport as an independent package.

## Decision

Implement the transport layer as a **separate package family** (`stream-contract-v1`
plus one package per transport: `file-stream-transport`, `sse-stream-transport`,
`ws-stream-transport`).

Key points:

- `stream-contract-v1` defines `StreamChunk`, `StreamProducer`, `StreamConsumer`,
  `StreamTransportAdapter`, and a reusable conformance test suite. It has no
  dependency on Farmhand.
- The three bundled transports each depend only on `stream-contract-v1` and Node.js
  built-ins. They are independently testable and independently replaceable.
- A `StreamRegistry` in Farmhand bridges `tractor.onNode("StreamChunk")` to all
  registered adapters. Per-adapter failures are isolated.
- Third-party authors can implement `StreamTransportAdapter` and validate against
  the conformance suite without taking Farmhand as a dependency — mirrors
  `effort-contract-v1` exactly.
- All three HTTP transports (SSE and WebSocket) share the existing port 42001
  sidecar — no new process required.

## Consequences

### Positive Consequences

- Reusability: any producer writing `StreamChunk` CRDT nodes feeds all registered
  transports — LLM tokens, build logs, test progress, background jobs.
- Testability: each transport has a clear, narrow interface and isolated unit tests.
- Extensibility: new transports (gRPC, MQTT, Kafka) require no changes to Farmhand
  internals; register and dispatch.
- Third-party ecosystem: `stream-contract-v1` will eventually be publishable as a
  standalone crate/package, following the same path as `effort-contract-v1`.

### Negative Consequences

- More packages to version and release simultaneously.
- Consumers must assemble the three transports; there is no "batteries-included"
  single import.

## Alternatives Considered

- **Embed in Farmhand.** Rejected because transport logic embedded in an `app/` package
  cannot be consumed by third-party adapters or tested independently.
- **Extend effort-contract-v1 with `subscribe`.** Rejected because streaming is
  fundamentally orthogonal to task execution. Mixing them would make `effort-contract-v1`
  depend on transport concerns and violate the single-responsibility principle.
  ADR-054 already established that stream observations are a separate, more general
  primitive than effort results.

## References

- [ADR-054: Generic Stream Observations and AgentResponse Projection](ADR-054-generic-stream-observations.md)
- [ADR-053: Host-Proxied LLM Streaming Boundary](ADR-053-host-proxied-llm-streaming.md)
- [ADR-018: Capability Contracts and Observability Gates](ADR-018-capability-contracts-and-observability-gates.md)
- [stream-contract-v1 feature spec](../../specs/features/stream-contract-v1.md)
