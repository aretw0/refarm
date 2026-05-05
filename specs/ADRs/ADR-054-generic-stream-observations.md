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

- `StreamSession` records stream lifecycle metadata keyed by `stream_ref`,
  including terminal statuses such as `completed` and `failed`.
- `StreamChunk` records ordered chunks from any stream.
- `StreamChunk` carries a `stream_ref`, `sequence`, `payload_kind`, `content`,
  `is_final`, `timestamp_ns`, and opaque `metadata` object. Terminal chunk
  payload kinds may distinguish text, tool-call-only, and empty completions.
- Domain-specific compatibility nodes remain projections. For LLM streaming, the
  host will dual-write `StreamChunk` observations and the existing partial
  `AgentResponse` projection during the migration period.
- Retention is explicit and conservative: no automatic compaction deletes
  `StreamChunk` or `StreamSession` observations until a governed delete/compact
  primitive exists and consumers have migrated from compatibility projections.
- The future compact primitive must be opt-in, scoped by namespace and stream
  identity, dry-run capable, and must preserve enough terminal lifecycle state
  for consumers to detect completion after historical chunks are removed.
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

### Retention and Compaction Policy

The default policy is append-only retention. Automatic write-path cleanup is
forbidden because stream chunks may be the only durable audit trail for partial
provider output, live tool progress, or future non-LLM producers.

A future governed compaction operation may remove historical `StreamChunk`
records only when all of the following are true:

1. The operator explicitly selects the namespace and stream scope.
2. A dry-run reports the candidate streams, chunk counts, byte estimate, and
   terminal state that would remain.
3. The stream has a terminal `StreamSession` (`completed` or `failed`) or an
   explicit final `StreamChunk` marker.
4. The operation preserves the terminal `StreamSession` and enough summary
   metadata for UIs to render status, timing, provider/model labels, and failure
   details after compaction.
5. Compatibility projections such as final `AgentResponse` nodes are preserved
   unless the caller opts into projection cleanup separately.

Until that primitive exists, storage pressure should be handled by operational
cleanup outside the stream write path rather than by implicit deletion.

### Negative Consequences

- Dual-write temporarily increases storage volume.
- Consumers must learn whether they are reading generic observations or a domain
  projection.
- A future migration may need to compact or garbage-collect old chunk streams,
  but that must be a governed operation rather than implicit write-path cleanup.
- Ordering and stream identity must be handled carefully for interleaved streams.

## Alternatives Considered

- **Keep only partial `AgentResponse` nodes.** Rejected because it makes
  non-agent streaming depend on an LLM-shaped schema.
- **Replace `AgentResponse` partials immediately.** Rejected because existing
  CLI, tests, and pi-agent consumers already rely on the compatibility shape.
- **Store only raw provider SSE frames.** Rejected because raw frames are useful
  audit artifacts but too provider-specific for generic live UI/progress
  consumers.
