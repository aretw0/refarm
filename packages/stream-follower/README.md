# @refarm.dev/stream-follower

The **client-side** half of Refarm's stream transports. Where `file-stream-transport`,
`sse-stream-transport`, and `ws-stream-transport` are the SERVER half (the daemon
*emits* chunks), this is the CLIENT: it *consumes* a `StreamChunk` stream — an agent
response, an effort — until the final chunk, from wherever the chunks live.

It exists because the transports' `subscribe` only fires on same-process writes, so it
can't follow a stream written by another process (the runtime daemon). This package
supplies that: a transport-agnostic follow machine plus two injectable sources.

## Usage

```ts
import { followStream, createFileChunkSource, createSseChunkSource } from "@refarm.dev/stream-follower";

// Local: poll the NDJSON file the daemon writes (same machine).
const local = createFileChunkSource("~/.refarm/streams", { newestSinceMs: Date.now() });

// Remote: consume the sidecar's SSE endpoint (any machine).
const remote = createSseChunkSource({ baseUrl: "http://host:42123" });

const result = await followStream(local, effortId, {
  timeoutMs: 45_000,
  onChunk: (c) => process.stdout.write(c.content), // incremental / streaming
});
console.log(result.content); // full response, assembled in sequence order
```

## Shape

- **`followStream(source, streamRef, options)`** — the neutral machine. Resolves with
  `{ content, final, chunks }` on `is_final`; rejects on timeout or a source error.
  De-dupes re-delivered chunks (poll re-reads, replay-on-subscribe) and assembles
  `content` in ascending `sequence`, so it's stable regardless of arrival races.
- **`createFileChunkSource(streamsDir, opts)`** — polls a local `<ref>.ndjson`
  written by the daemon. The extraction of apps/refarm's `followStreamFile` into a
  reusable, transport-shaped client.
- **`createSseChunkSource({ baseUrl })`** — consumes the sidecar's `/stream/:ref` SSE
  endpoint (`data: <json>` frames, ignoring `: heartbeat` and `[DONE]`). The remote
  path.

This is the reusable base the agent SDK (`createAgentSession`) composes on: submit an
effort, then `followStream` its response — local or remote via the injected source.
