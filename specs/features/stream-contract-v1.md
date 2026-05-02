# Feature: stream-contract-v1 — TypeScript Streaming Transport Layer

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Arthur Silva

---

## Summary

Materialises ADR-054's `StreamChunk` CRDT observations into a consumable TypeScript
streaming layer. Defines `stream-contract-v1` as the canonical capability contract for
ordered chunk delivery, implements a `StreamRegistry` that bridges Farmhand's in-process
CRDT to external consumers, and ships three bundled transport adapters — File (NDJSON),
SSE, and WebSocket — demonstrating that the architecture accommodates every integration
style from CLI polling to live browser UIs.

---

## User Stories

**As a** Refarm developer  
**I want** to subscribe to a `stream_ref` and receive LLM tokens as they arrive  
**So that** I can see pi-agent's response in real time without waiting for completion

**As a** third-party plugin author  
**I want** `stream-contract-v1` to define a stable, transport-neutral interface  
**So that** I can build a custom streaming adapter without modifying Farmhand internals

**As a** Refarm developer  
**I want** `StreamChunk` nodes written by any producer to reach all registered transports  
**So that** build logs, test progress, and LLM tokens all share the same downstream path

**As a** Refarm developer  
**I want** a conformance test harness included in `stream-contract-v1`  
**So that** I can validate any new transport adapter before merging

---

## Acceptance Criteria

1. **Given** `stream-contract-v1` is installed as a dependency  
   **When** a third party implements `StreamTransportAdapter`  
   **Then** running `runConformanceTests(factory)` verifies the adapter is spec-compliant

2. **Given** Farmhand is running with all three transports registered  
   **When** Tractor writes a `StreamChunk` CRDT node  
   **Then** the chunk appears in the NDJSON file, SSE stream, and WebSocket stream within 100 ms

3. **Given** a File transport is registered  
   **When** a late subscriber calls `subscribe(stream_ref, cb)` after some chunks were written  
   **Then** all past chunks are replayed in sequence order before live chunks begin

4. **Given** a chunk with `is_final: true` arrives  
   **When** the SSE transport delivers it  
   **Then** the client receives a `data: [DONE]` frame and the connection closes cleanly

5. **Given** a chunk with `is_final: true` arrives  
   **When** the WebSocket transport delivers it  
   **Then** the server sends the final chunk and closes with code 1000

6. **Given** one registered adapter throws during `dispatch`  
   **When** `StreamRegistry.dispatch` is called  
   **Then** the exception is swallowed and all other adapters still receive the chunk

7. **Given** a `stream_ref` has no active SSE or WebSocket subscribers  
   **When** the SSE or WebSocket transports receive chunks for that `stream_ref`  
   **Then** the chunks are buffered or dropped — no error propagates to `StreamRegistry`

---

## Technical Approach

**High-level design:**

```
Tractor CRDT (in-process)
  tractor.onNode("StreamChunk", node)
    └─ StreamRegistry.dispatch(chunk)
         ├─ FileStreamTransport.write(chunk)   → ~/.refarm/streams/<ref>.ndjson
         ├─ SseStreamTransport.write(chunk)    → GET /stream/:ref (port 42001)
         └─ WsStreamTransport.write(chunk)     → WS /ws/stream (port 42001)
```

**Package layout:**

```
packages/
  stream-contract-v1/      ← contract types + InMemoryStreamTransport + conformance
  file-stream-transport/   ← NDJSON append + fs.watch (replay capable)
  sse-stream-transport/    ← EventSource-compatible SSE on port 42001
  ws-stream-transport/     ← WebSocket upgrade on port 42001

apps/farmhand/src/
  stream-registry.ts       ← StreamRegistry (CRDT bridge, isolated dispatch)
  index.ts                 ← registers all three transports after tractor.boot()
```

**Key decisions:**

- `stream-contract-v1` is a separate package so third-party adapters can depend on
  it without taking Farmhand as a dependency — mirrors the `effort-contract-v1` model.
- All three HTTP transports share port 42001 (existing Farmhand sidecar) — no new
  process or port needed.
- File transport is the replay source; SSE and WebSocket compose with it for
  late-subscriber catch-up.
- Per-adapter isolation in `StreamRegistry` means a broken transport never silences
  a working one.
- ADR-054 retention policy: NDJSON files are append-only, no automatic deletion.

---

## API/Interface

```typescript
// packages/stream-contract-v1/src/index.ts

export const STREAM_CAPABILITY = "stream:v1" as const;

export interface StreamChunk {
  stream_ref: string;
  content: string;
  sequence: number;
  is_final: boolean;
  payload_kind?: "text_delta" | "final_text" | "final_tool_call" | "final_empty";
  metadata?: unknown;
}

export interface StreamProducer {
  write(chunk: StreamChunk): void;
}

export interface StreamConsumer {
  subscribe(stream_ref: string, onChunk: (chunk: StreamChunk) => void): () => void;
}

export interface StreamTransportAdapter extends StreamProducer, StreamConsumer {
  readonly capability: typeof STREAM_CAPABILITY;
}
```

```typescript
// packages/stream-contract-v1/src/conformance.ts

export function runConformanceTests(factory: () => StreamTransportAdapter): void;
```

```typescript
// apps/farmhand/src/stream-registry.ts

export class StreamRegistry {
  register(adapter: StreamProducer): void;
  dispatch(chunk: StreamChunk): void;
}
```

---

## Test Coverage

**Conformance tests (any adapter):**

- [ ] Delivers a chunk to a subscriber
- [ ] Replays past chunks on late subscribe
- [ ] Delivers `is_final=true` chunk and signals completion
- [ ] Delivers to multiple subscribers for the same `stream_ref`
- [ ] Maintains sequence order under rapid writes

**Unit tests (TDD):**

- [ ] `StreamRegistry.dispatch` calls all adapters even if one throws
- [ ] `FileStreamTransport` write → read roundtrip in temp dir
- [ ] `FileStreamTransport` late-subscribe replay returns past chunks in order
- [ ] `SseStreamTransport` emits `text/event-stream` framing
- [ ] `SseStreamTransport` sends `data: [DONE]` on `is_final=true`
- [ ] `WsStreamTransport` accepts subscribe handshake and delivers chunks
- [ ] `WsStreamTransport` closes with code 1000 on `is_final=true`

**Smoke gate:**

- [ ] pi-agent `respond` emits `StreamChunk` CRDT nodes → FileStreamTransport writes
  NDJSON → file contains all chunks in sequence order

---

## Implementation Tasks

**SDD:**

- [x] Design `StreamChunk` / `StreamProducer` / `StreamConsumer` / `StreamTransportAdapter`
- [x] Design `StreamRegistry` CRDT bridge
- [x] Design three transport adapters (File, SSE, WebSocket)
- [x] Design conformance test harness
- [x] Write design doc
- [ ] Write ADR-055 (stream-contract-v1 transport layer as separate package family)

**TDD:**

- [ ] Conformance tests in `packages/stream-contract-v1/src/conformance.ts`
- [ ] `StreamRegistry` isolated-failure test
- [ ] `FileStreamTransport` unit tests
- [ ] `SseStreamTransport` unit tests
- [ ] `WsStreamTransport` unit tests
- [ ] Smoke gate scenario

**DDD:**

- [ ] Scaffold `packages/stream-contract-v1/` with `StreamChunk`, `StreamProducer`,
  `StreamConsumer`, `StreamTransportAdapter`, `InMemoryStreamTransport`
- [ ] Implement `runConformanceTests` in `packages/stream-contract-v1/src/conformance.ts`
- [ ] Scaffold `packages/file-stream-transport/` — NDJSON write + fs.watch + replay
- [ ] Scaffold `packages/sse-stream-transport/` — GET /stream/:ref on port 42001
- [ ] Scaffold `packages/ws-stream-transport/` — WebSocket upgrade on port 42001
- [ ] Implement `StreamRegistry` in `apps/farmhand/src/stream-registry.ts`
- [ ] Add `toStreamChunk` mapper for Tractor node shape in Farmhand
- [ ] Wire `tractor.onNode("StreamChunk")` → `streamRegistry.dispatch` in Farmhand `index.ts`
- [ ] Register all three transports in Farmhand `main()`
- [ ] Smoke gate: verify end-to-end with pi-agent respond

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-02-stream-contract-v1-design.md)
- [ADR-054: Generic Stream Observations](../ADRs/ADR-054-generic-stream-observations.md)
- [ADR-053: Host-Proxied LLM Streaming](../ADRs/ADR-053-host-proxied-llm-streaming.md)
- [ADR-018: Capability Contracts and Observability Gates](../ADRs/ADR-018-capability-contracts-and-observability-gates.md)
- [Farmhand Task Execution spec](./farmhand-task-execution.md)
- [Pi-Agent Effort Bridge spec](./pi-agent-effort-bridge.md)
