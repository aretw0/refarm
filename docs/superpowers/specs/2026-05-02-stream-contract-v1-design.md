# Stream Contract v1 — Design Doc

**Date:** 2026-05-02  
**Status:** Approved  
**Feature:** Slice 7.1 — stream-contract-v1 TypeScript transport layer

---

## Context

ADR-053 delivered host-proxied LLM streaming: Tractor reads SSE from providers, persists
`StreamChunk` CRDT nodes (sequence + payload_kind + content), and synthesises a final
`AgentResponse` for guest parsers.

ADR-054 generalised the model: `StreamChunk` and `StreamSession` are now the canonical
host-owned observation primitive, independent of LLM semantics. Any long-running producer —
LLM tokens, build logs, test progress, background jobs, sync progress — should emit
`StreamChunk` nodes.

What neither ADR specified is the **TypeScript-level transport layer** that makes
`StreamChunk` nodes consumable by CLI clients, WebSocket UIs, and server-sent event
subscribers. Farmhand holds the CRDT in-process; external consumers need a framing
protocol to receive ordered chunks as they arrive. This slice fills that gap.

---

## Goals

1. A stable TypeScript capability contract (`stream-contract-v1`) that any transport
   can implement.
2. A `StreamRegistry` that bridges `tractor.onNode("StreamChunk")` to all registered
   transports in Farmhand.
3. Three bundled transports: **File** (NDJSON), **SSE**, **WebSocket** — demonstrating
   the architecture works for every integration style.
4. Conformance test harness with `InMemoryStreamTransport` so third-party adapters can
   validate before shipping.
5. Maximum generality: any `stream_ref` producer (LLM, build, test runner, pi-agent)
   feeds the same downstream consumers.

---

## Canonical Contract (`packages/stream-contract-v1/`)

```typescript
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
  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void
  ): () => void; // returns unsubscribe
}

export interface StreamTransportAdapter extends StreamProducer, StreamConsumer {
  readonly capability: typeof STREAM_CAPABILITY;
}
```

`InMemoryStreamTransport` is bundled as `packages/stream-contract-v1/src/in-memory.ts`
for conformance tests and unit-test mocking.

---

## StreamRegistry — CRDT Bridge

Added to `apps/farmhand/src/stream-registry.ts`:

```typescript
export class StreamRegistry {
  private adapters: StreamProducer[] = [];

  register(adapter: StreamProducer): void {
    this.adapters.push(adapter);
  }

  dispatch(chunk: StreamChunk): void {
    for (const adapter of this.adapters) {
      try { adapter.write(chunk); } catch { /* isolated */ }
    }
  }
}
```

Wired in `apps/farmhand/src/index.ts`:

```typescript
const streamRegistry = new StreamRegistry();

tractor.onNode("StreamChunk", (node) => {
  streamRegistry.dispatch(toStreamChunk(node));
});
```

`toStreamChunk` maps Tractor's internal node shape to `StreamChunk`. All three
transport adapters are registered immediately after boot. Per-adapter failure is
isolated — one failing transport never affects others.

---

## Three Bundled Transports

All three are implementations of `StreamTransportAdapter`. All HTTP-based ones
share port **42001** (existing Farmhand sidecar).

### Transport 1: File (NDJSON)

`packages/file-stream-transport/`

- **Write path**: appends `JSON.stringify(chunk) + "\n"` to
  `~/.refarm/streams/<stream_ref>.ndjson`
- **Read path**: `subscribe()` returns a file watcher via `fs.watch`; on change,
  reads new lines since last known offset and emits each parsed chunk
- **Replay**: full file read from offset 0 on first subscribe, so late subscribers
  catch up before watching for new lines
- **Cleanup**: files are append-only; no automatic deletion (matches ADR-054 retention)

### Transport 2: SSE (Server-Sent Events)

`packages/sse-stream-transport/`

- **Endpoint**: `GET /stream/:ref` on port 42001
- **Connection**: responds with `Content-Type: text/event-stream`, flushes heartbeat
  every 15 s to keep proxies alive
- **Write path**: adapter holds a map of `stream_ref → Set<Response>`; `write()` calls
  `res.write("data: " + JSON.stringify(chunk) + "\n\n")` for each connected client
- **Replay**: on connect, past chunks are replayed from the File transport if registered
  (SSE transport is composable with File)
- **Reconnect**: clients use `EventSource` with `Last-Event-ID` based on `sequence`
- **Final**: `is_final=true` sends a `data: [DONE]\n\n` frame and closes the connection

### Transport 3: WebSocket

`packages/ws-stream-transport/`

- **Upgrade**: HTTP upgrade at `GET /ws/stream` on port 42001, subprotocol `stream-v1`
- **Subscription**: client sends `{"action":"subscribe","stream_ref":"<ref>"}` after
  handshake
- **Write path**: adapter holds a map of `stream_ref → Set<WebSocket>`; `write()` calls
  `ws.send(JSON.stringify(chunk))` for all subscribers of that `stream_ref`
- **Replay**: same composable approach as SSE — reads past chunks from File transport
- **Final**: server sends `{"is_final":true,...}` and closes with code 1000

---

## Test Strategy

### Conformance Tests (`packages/stream-contract-v1/src/conformance.ts`)

A reusable test suite that any `StreamTransportAdapter` can run against:

```typescript
export function runConformanceTests(
  factory: () => StreamTransportAdapter
): void {
  it("delivers chunk to subscriber", async () => { /* ... */ });
  it("replays past chunks on late subscribe", async () => { /* ... */ });
  it("delivers final chunk and signals completion", async () => { /* ... */ });
  it("delivers to multiple subscribers for same stream_ref", async () => { /* ... */ });
  it("maintains sequence order", async () => { /* ... */ });
}
```

### Unit Tests

- **StreamRegistry**: isolated failure — one adapter throwing must not block others;
  verify `dispatch` calls all registered adapters even after partial failure
- **FileStreamTransport**: write → read roundtrip in temp dir; late-subscribe replay
- **SseStreamTransport**: mock HTTP server; verify event framing; verify `[DONE]` on final
- **WsStreamTransport**: mock WS server; verify subscribe handshake; verify chunk delivery

### Farmhand Integration

- `loadInstalledPlugins` existing tests remain green
- Smoke: pi-agent `respond` emits `StreamChunk` nodes → FileStreamTransport writes
  NDJSON → `cat ~/.refarm/streams/<ref>.ndjson` shows all chunks in order

---

## End-to-End Flow

```
pi-agent respond (via effort queue)
  → Tractor LLM bridge: stream:true
  → Tractor writes StreamChunk CRDT nodes (sequence 0..N, is_final on last)

Farmhand tractor.onNode("StreamChunk", node)
  → streamRegistry.dispatch(chunk)
    → FileStreamTransport.write(chunk)   → ~/.refarm/streams/<ref>.ndjson
    → SseStreamTransport.write(chunk)    → HTTP /stream/<ref> clients
    → WsStreamTransport.write(chunk)     → WS /ws/stream subscribers

CLI (future): refarm ask "o que é CRDT?"
  → pi-agent respond --stream-ref <ref>
  → subscribes to FileStreamTransport
  → prints tokens as they arrive
```

---

## Package Layout

```
packages/
  stream-contract-v1/          ← contract types + InMemoryStreamTransport + conformance tests
    src/
      index.ts                 ← exports StreamChunk, StreamProducer, StreamConsumer, ...
      in-memory.ts             ← InMemoryStreamTransport
      conformance.ts           ← runConformanceTests()
    package.json

  file-stream-transport/       ← NDJSON append + fs.watch
  sse-stream-transport/        ← GET /stream/:ref on port 42001
  ws-stream-transport/         ← WebSocket upgrade at /ws/stream

apps/farmhand/
  src/
    stream-registry.ts         ← StreamRegistry (CRDT bridge)
    index.ts                   ← registers all three transports after boot
```

---

## Relation to ADRs

- **ADR-054**: stream-contract-v1 is the TypeScript-layer materialisation of ADR-054's
  `StreamChunk`/`StreamSession` CRDT primitives. The CRDT records are the source of
  truth; the transports are subscribers.
- **ADR-053**: stream-contract-v1 is LLM-agnostic — it subscribes to whatever the host
  writes as `StreamChunk` nodes, whether those come from LLM streaming (ADR-053) or
  any other producer.
- **ADR-018**: `stream-contract-v1` follows the capability contract model exactly —
  versioned API, functional semantics, error model, conformance tests.

A new **ADR-055** documents the decision to implement the transport layer as a separate
package family rather than embedding it in Farmhand, and to support all three transport
styles as first-class bundled implementations.

---

## Non-Goals

- Streaming over the effort queue / effort-contract-v1 `subscribe` (future slice)
- Multi-turn conversation state across streams (Slice 7.2 scope)
- `refarm ask` CLI command (context-provider-v1 spec — separate slice)
- TUI rendering of stream output (emerges naturally once stream-contract-v1 is stable)
- Automatic stream chunk compaction (governed operation per ADR-054 retention policy)
