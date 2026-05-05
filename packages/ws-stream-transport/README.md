# @refarm.dev/ws-stream-transport

WebSocket `StreamTransportAdapter` for the Farmhand HTTP sidecar. Attaches to an `http.Server` upgrade handler at `/ws/stream` and broadcasts `StreamChunk` objects to subscribed clients.

## When to use

- You are implementing the Farmhand HTTP sidecar and need bidirectional or low-latency streaming to browser/Node clients.
- Your client needs to subscribe to multiple streams over a single connection.
- You prefer binary JSON frames over SSE text frames for streaming payloads.

Prefer `sse-stream-transport` when clients only need one-directional streaming and automatic reconnection without extra client code.

## Installation

```bash
npm install @refarm.dev/ws-stream-transport
```

## Usage

```typescript
import http from "node:http";
import { WsStreamTransport } from "@refarm.dev/ws-stream-transport";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";

const server = http.createServer(app);
const file = new FileStreamTransport("/var/lib/refarm/streams");
const ws = new WsStreamTransport(server, file); // attaches upgrade handler automatically

server.listen(3000);

// Push a chunk (broadcasts to all subscribers of this stream)
await ws.write({
  stream_ref: "session-abc123",
  chunk: "token",
  is_final: false,
  timestamp_ns: Date.now() * 1_000_000,
});
```

### Browser client

```javascript
const socket = new WebSocket("ws://localhost:3000/ws/stream");

socket.onopen = () => {
  socket.send(JSON.stringify({ action: "subscribe", stream_ref: "session-abc123" }));
};

socket.onmessage = (e) => {
  const chunk = JSON.parse(e.data);
  if (chunk.is_final) socket.close();
};
```

## Behaviour

- Client sends `{ action: "subscribe", stream_ref: "..." }` after connecting.
- Replays file-persisted chunks before going live (if `FileStreamTransport` provided).
- Closes the WebSocket socket automatically when `is_final: true` chunk is written.

## Related packages

- [`@refarm.dev/file-stream-transport`](../file-stream-transport) — optional durable backing store
- [`@refarm.dev/sse-stream-transport`](../sse-stream-transport) — SSE alternative
- [`@refarm.dev/stream-contract-v1`](../stream-contract-v1) — `StreamTransportAdapter` contract

## License

MIT
