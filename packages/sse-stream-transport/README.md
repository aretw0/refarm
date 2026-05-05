# @refarm.dev/sse-stream-transport

HTTP Server-Sent Events `StreamTransportAdapter` for the Farmhand HTTP sidecar. Exposes a `/stream/{stream_ref}` endpoint that pushes `StreamChunk` objects to browser clients as `data:` frames.

## When to use

- You are implementing the Farmhand HTTP sidecar and need to stream LLM output or task events to browser clients.
- Your client environment supports `EventSource` (all modern browsers, no extra deps).
- You want one-directional server→client streaming with automatic reconnection (SSE handles this natively).

Prefer `ws-stream-transport` when you need bidirectional messaging.

## Installation

```bash
npm install @refarm.dev/sse-stream-transport
```

## Usage

```typescript
import http from "node:http";
import { SseStreamTransport } from "@refarm.dev/sse-stream-transport";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";

// Optional: file-backed persistence
const file = new FileStreamTransport("/var/lib/refarm/streams");
const sse = new SseStreamTransport({ file });

// Wire up to your HTTP server
const server = http.createServer((req, res) => {
  const handler = sse.getRouteHandler(); // handles GET /stream/:stream_ref
  handler(req, res);
});

// Push a chunk (broadcasts to all open SSE connections for this stream)
await sse.write({
  stream_ref: "session-abc123",
  chunk: "token",
  is_final: false,
  timestamp_ns: Date.now() * 1_000_000,
});
```

### Browser client

```javascript
const es = new EventSource("/stream/session-abc123");
es.onmessage = (e) => {
  const chunk = JSON.parse(e.data);
  if (chunk.is_final) es.close();
};
```

## Behaviour

- 15-second heartbeat keepalive (`data: \n\n`) to prevent proxy timeouts.
- Sends `data: [DONE]\n\n` on final chunk, then closes the connection.
- Replays file-persisted chunks to late subscribers before going live.

## Related packages

- [`@refarm.dev/file-stream-transport`](../file-stream-transport) — optional durable backing store
- [`@refarm.dev/ws-stream-transport`](../ws-stream-transport) — WebSocket alternative
- [`@refarm.dev/stream-contract-v1`](../stream-contract-v1) — `StreamTransportAdapter` contract

## License

MIT
