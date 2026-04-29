# ADR-054: Generic Stream Observations and AgentResponse Projection

## Status

**Accepted**

## Context

ADR-053 accepted host-proxied LLM streaming and proved that Tractor can read
provider SSE responses, persist partial `AgentResponse` nodes, and return a
parser-compatible final response to the WASM guest. That unlocked opt-in token
streaming without moving provider credentials into plugins.

The current persistence shape is intentionally compatible, but it is still
LLM-shaped: partial stream chunks are stored directly as `AgentResponse` nodes.
That is useful for pi-agent clients, but it would make future live output paths
(build logs, test progress, tool progress, sync progress, plugin background jobs,
and non-LLM streams) depend on an agent-specific schema.

Refarm needs a stream primitive that lives below LLM/provider semantics. The host
should be able to observe ordered chunks from any long-running producer, then
project those observations into domain-specific nodes such as `AgentResponse`,
`UsageRecord`, tool-call logs, UI progress records, or future plugin-defined
views.

## Decision

Introduce generic stream observation nodes owned by the host:

- `StreamSession` records stream lifecycle metadata keyed by `stream_ref`.
- `StreamChunk` records ordered chunks from any stream.
- `StreamChunk` carries a `stream_ref`, `sequence`, `payload_kind`, `content`,
  `is_final`, `timestamp_ns`, and opaque `metadata` object.
- Domain-specific compatibility nodes remain projections. For LLM streaming, the
  host will dual-write `StreamChunk` observations and the existing partial
  `AgentResponse` projection during the migration period.
- Generic transport/framing remains separate from domain codecs:
  - `tractor::streaming` owns generic framing and stream observation builders.
  - LLM/provider parsing remains in the LLM bridge layer.
  - `AgentResponse` remains an LLM/agent projection, not the universal stream
    primitive.

## Consequences

### Positive Consequences

- Live output becomes reusable for LLM tokens, tool progress, test/build logs,
  background jobs, sync progress, and future plugins.
- UI and WebSocket clients can consume a generic stream substrate while existing
  pi-agent clients keep working through `AgentResponse`.
- Host-owned credentials and route enforcement remain unchanged.
- The architecture aligns with Refarm's source-of-truth model: generic
  observations first, domain projections second.

### Negative Consequences

- Dual-write temporarily increases storage volume.
- Consumers must learn whether they are reading generic observations or a domain
  projection.
- A future migration may need to compact or garbage-collect old chunk streams.
- Ordering and stream identity must be handled carefully for interleaved streams.

## Alternatives Considered

- **Keep only partial `AgentResponse` nodes.** Rejected because it makes
  non-agent streaming depend on an LLM-shaped schema.
- **Replace `AgentResponse` partials immediately.** Rejected because existing
  CLI, tests, and pi-agent consumers already rely on the compatibility shape.
- **Store only raw provider SSE frames.** Rejected because raw frames are useful
  audit artifacts but too provider-specific for generic live UI/progress
  consumers.
