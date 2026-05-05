# @refarm.dev/file-stream-transport

NDJSON file-backed `StreamTransportAdapter`. Each stream is persisted as a `.ndjson` file, supports replay, and broadcasts live chunks to in-memory subscribers.

## When to use

- You need a durable audit log for event streams (every chunk survives process restarts).
- You are building the Farmhand HTTP sidecar and need a backing store for `sse-stream-transport` or `ws-stream-transport`.
- You need to replay a past stream for debugging or late consumers.

Do **not** use this as the primary transport when stream volume is high — NDJSON append is synchronous and not designed for high-throughput fan-out.

## Installation

```bash
npm install @refarm.dev/file-stream-transport
```

## Usage

```typescript
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";

const transport = new FileStreamTransport("/var/lib/refarm/streams");

// Write a chunk (appends to /var/lib/refarm/streams/{stream_ref}.ndjson)
await transport.write({
  stream_ref: "session-abc123",
  chunk: "Hello",
  is_final: false,
  timestamp_ns: Date.now() * 1_000_000,
});

// Replay all past chunks, then subscribe to new ones
const unsubscribe = await transport.subscribe("session-abc123", (chunk) => {
  console.log(chunk.chunk);
});

// Replay only (no live subscription)
const chunks = await transport.replay("session-abc123");
```

## File layout

```
{baseDir}/
  {stream_ref}.ndjson   ← one JSON object per line, append-only
```

## Related packages

- [`@refarm.dev/sse-stream-transport`](../sse-stream-transport) — SSE adapter that uses this for persistence
- [`@refarm.dev/ws-stream-transport`](../ws-stream-transport) — WebSocket adapter that uses this for persistence
- [`@refarm.dev/stream-contract-v1`](../stream-contract-v1) — the `StreamTransportAdapter` contract

## License

MIT
