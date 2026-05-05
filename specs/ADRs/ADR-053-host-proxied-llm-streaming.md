# ADR-053: Host-Proxied LLM Streaming Boundary

## Status

**Accepted**

## Context

pi-agent/farmhand now has partial `AgentResponse` schema, SSE parsing, chunk persistence helpers, provider `stream: true` gates, and an active stream sink context (`prompt_ref`, `model`, `last_sequence`). Tractor now provides the host-proxied transport: bytes are read through a streaming SSE seam, partial chunks are stored by the host, and final provider-compatible JSON is synthesized for existing guest parsers.

The current LLM boundary is `llm-bridge::complete-http(provider, base-url, path, headers, body) -> list<u8>`. Tractor owns provider credentials and performs the HTTP request on behalf of the WASM plugin. This is sovereign and safe, but buffered: the plugin receives bytes only after the host response completes.

Direct `wasi::http` from the plugin could expose chunked reads to pi-agent, but would also require giving provider credentials and route policy to the sandboxed plugin. That weakens the existing host-owned credential boundary.

## Decision

Keep provider credentials and route enforcement in the Tractor host. Do not enable provider `stream: true` via direct plugin `wasi::http` unless a later ADR explicitly accepts the credential/security trade-off.

The preferred streaming transport is a host-proxied extension of `llm-bridge` that preserves host-owned credentials and route checks while making SSE chunks observable before the final response completes.

This is not a WASM-only architectural constraint. The streaming core should stay target-agnostic where practical: native Tractor owns transport, buffering, validation, and persistence boundaries; WASM is the plugin packaging/isolation boundary that should benefit from the same core semantics rather than force all design choices. Generic transport/framing primitives (for example SSE frame buffering) should remain reusable outside LLM-specific code; only provider JSON interpretation and `AgentResponse` projection belong in the LLM streaming layer.

The implemented WIT shape satisfies these constraints:

- plugin can correlate chunks to a prompt (`prompt_ref`) without exposing provider secrets;
- host continues to enforce provider/base-url/path/body policy;
- partial chunks become `AgentResponse` nodes with `is_final=false` and monotonic `sequence`;
- final response remains `is_final=true` and follows the last stored partial sequence;
- `streaming_reader_available()` flips to true only with tests proving end-to-end partial persistence.

The initial implementation includes an ignored pi-agent harness test that proves `LLM_STREAM_RESPONSES=1` sends provider `stream:true`, stores partial `AgentResponse` chunks, and stores the final `AgentResponse` after the last partial sequence.

The first implementation should prefer an append-only host-owned stream record over a guest callback. Component-model callbacks during an imported host call are harder to reason about and may re-enter the same store. A host-owned stream record is simpler: the guest passes stream metadata, the host reads provider SSE incrementally, and the host writes chunk observations using the existing CRDT store.

A minimal candidate contract is:

```wit
record stream-response-metadata {
    prompt-ref: string,
    model: string,
    provider-family: string,
    last-sequence: option<u32>,
}

record stream-response-result {
    final-body: list<u8>,
    last-sequence: option<u32>,
    stored-chunks: u32,
}

complete-http-stream: func(
    provider: string,
    base-url: string,
    path: string,
    headers: list<tuple<string, string>>,
    body: list<u8>,
    stream-metadata: stream-response-metadata,
) -> result<stream-response-result, string>;
```

This keeps `complete-http` as the default buffered primitive. `complete-http-stream` is opt-in and can be introduced without forcing non-streaming plugins to understand streaming. For true provider SSE responses, the host may persist partial text chunks from SSE frames while returning a synthesized provider-compatible final JSON body to the guest so existing final-response, usage, and tool-call parsers remain valid.

## Consequences

### Positive Consequences

- Preserves the current security boundary: API keys remain in Tractor.
- Avoids a misleading implementation where `LLM_STREAM_RESPONSES=1` silently leaks credentials into plugin env.
- Keeps current buffered `complete-http` path intact for non-streaming and fallback compatibility.
- Enables provider `stream: true` only through the tested host-proxied streaming primitive.

### Negative Consequences

- Host and guest now share a stricter contract around synthesized final JSON; future provider event variants must preserve that contract.
- Some SSE parsing/persistence logic lives at the host boundary and may need shared target-neutral extraction to avoid duplication.

## Alternatives Considered

- **Direct plugin `wasi::http` streaming:** rejected for now because provider credentials and route enforcement would move into the plugin sandbox.
- **Keep buffered `complete-http` and call the callback with final bytes:** already implemented as a seam, but it cannot deliver live token streaming.
- **Host stores partial CRDT nodes directly:** viable if WIT callbacks are awkward, but risks duplicating provider-specific SSE parsing outside pi-agent unless shared carefully.
