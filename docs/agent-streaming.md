# pi-agent streaming responses

`pi-agent` supports opt-in provider SSE streaming through Tractor's host-owned
`llm-bridge::complete-http-stream` boundary.

Streaming is disabled by default. Enable it per process/session with:

```bash
LLM_STREAM_RESPONSES=1
```

For startup plugins loaded by the Tractor daemon, the equivalent governed CLI
entrypoint is:

```bash
tractor --llm-stream-responses --plugin ./packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm
```

Project config can also govern startup plugin streaming. `.refarm/config.json`
may set `"stream_responses": true` (or explicit `false`, which maps to
`LLM_STREAM_RESPONSES=0` and overrides process env for the plugin).

When enabled, pi-agent requests provider-level `stream: true`; Tractor keeps
provider credentials and route enforcement in the host, reads the SSE response,
dual-writes generic `StreamChunk` observations plus partial `AgentResponse`
projection nodes, and returns a parser-compatible final provider JSON body to the
guest.

## Response shape

- Each stream has a generic `StreamSession` observation keyed by `stream_ref`,
  with lifecycle status (`active`, `completed`, or `failed`), timing,
  `last_sequence`, and `chunk_count` metadata. Failed sessions include sanitized
  `metadata.failure_kind` and `metadata.failure_reason` fields.
- Each persisted delta has a generic `StreamChunk` observation with
  `stream_ref`, `sequence`, `payload_kind`, `content`, `is_final`, and metadata.
- A final `StreamChunk` marker uses `is_final: true`. Its `payload_kind` is
  `final_text` for assembled text, `final_tool_call` for tool-call-only streams,
  or `final_empty` for usage/empty terminal observations.
- For compatibility, partial chunks are also projected to `AgentResponse` nodes
  with `is_final: false`.
- Partial `content` is a delta. Clients should order by `sequence` and append.
- The final response is `is_final: true` and its `content` is the assembled text.
- The final response sequence is the last partial sequence plus one.
- Tool-call/tool-use deltas are synthesized into final provider-compatible JSON
  so existing tool loops continue to work.
- Retention is conservative: stream observations are not implicitly compacted on
  write. Future cleanup should use a governed delete/compact primitive.

## CLI consumption

`tractor prompt --format plain` and `tractor watch --format plain` render partial
chunks as append-only deltas. When the final response arrives after partials, the
CLI terminates the line instead of printing the full final content again. If no
partials were observed, the final response prints normally.

JSON mode keeps emitting each `AgentResponse` event with `sequence` and
`is_final`, so structured consumers can maintain their own per-`prompt_ref`
accumulator.

Generic stream observations are queryable without a daemon:

```bash
tractor query --type StreamSession --stream-ref urn:tractor:stream:agent-response:<prompt-ref>
tractor query --type StreamChunk --stream-ref urn:tractor:stream:agent-response:<prompt-ref>
```

They can also be watched through the polling fallback:

```bash
tractor watch --type StreamChunk --stream-ref urn:tractor:stream:agent-response:<prompt-ref> --until-final
tractor watch --type StreamSession --stream-ref urn:tractor:stream:agent-response:<prompt-ref> --until-final
```

For generic streams, `--until-final` stops on `is_final: true`, terminal
`payload_kind` (`final_text`, `final_tool_call`, `final_empty`), or terminal
session status (`completed`, `failed`).

WebSocket/browser sync remains schema-neutral: `BrowserSyncClient` transports
Loro binary updates and does not special-case `AgentResponse`, `StreamChunk`, or
`StreamSession`. UI code should decide which node type it observes and then use
one of the reducers below.

TypeScript consumers can use
`applyAgentResponseStreamEvent(...)` / `reduceAgentResponseStreamEvents(...)`
from `@refarm.dev/tractor` as the default `AgentResponse` accumulation
primitive, or `reduceAgentResponseStreamEventsByPrompt(...)` when events from
multiple `prompt_ref` values may be interleaved. Use
`isTerminalAgentResponseStreamEvent(...)` or
`isTerminalAgentResponseStreamState(...)` to detect completion. Use
`agentResponseStreamRef(promptRef)` to derive the generic `stream_ref` for the
same prompt, or `promptRefFromAgentResponseStreamRef(streamRef)` to map back.
Consumers that observe generic `StreamChunk` nodes directly can use
`reduceStreamChunkEvents(...)`,
`reduceStreamChunkEventsByStream(...)`, `isTerminalStreamChunk(...)`,
`isTerminalStreamChunkState(...)`, `isStreamChunkPayloadKind(...)`,
`isTextDeltaStreamChunkPayloadKind(...)`, or final-kind helpers such as
`isFinalToolCallStreamChunkPayloadKind(...)`; the reducer also preserves the
latest chunk `metadata`, with helpers such as `streamChunkPromptRef(...)`,
`streamChunkProviderFamily(...)`, and `streamChunkModel(...)` for UI labels.
Consumers that observe `StreamSession` lifecycle nodes can use
`reduceStreamSessionEvents(...)`,
`reduceStreamSessionEventsByStream(...)`, `isTerminalStreamSession(...)`,
`isCompletedStreamSession(...)`, `isFailedStreamSession(...)`,
`streamSessionFailureKind(...)`, or `streamSessionFailureReason(...)`. The
package also exports status/kind/payload constants and type guards plus the
`StreamSessionStatus`, `StreamSessionKind`, `StreamChunkPayloadKind`, and
`TerminalStreamChunkPayloadKind` type aliases for switch statements and UI state
machines.
Use `orderAgentResponseStreamEvents(...)`, `orderStreamChunkEvents(...)`, or
`orderStreamSessionEvents(...)` before reducing if the source does not already
emit events in sequence order.

## Local validation

Use economical scoped checks while developing:

```bash
npm run agent:streaming:check
```

Validate TypeScript client accumulation helpers with:

```bash
npm run agent:streaming:clients
```

Run the WASM harness only when the `pi_agent.wasm` artifact is fresh:

```bash
npm run agent:streaming:harness
```

Rebuild the component only when pi-agent/WIT changed and the harness must run:

```bash
npm run agent:streaming:harness:build
```

Avoid full repo builds/tests for streaming-only changes unless preparing a push
or release gate.
