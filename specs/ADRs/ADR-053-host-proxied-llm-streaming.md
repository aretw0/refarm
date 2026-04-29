# ADR-053: Host-Proxied LLM Streaming Boundary

## Status

**Proposed**

## Context

pi-agent/farmhand now has partial `AgentResponse` schema, SSE parsing, chunk persistence helpers, provider `stream: true` gates, and an active stream sink context (`prompt_ref`, `model`, `last_sequence`). The remaining unlock is transport: bytes must arrive incrementally before the final provider JSON is parsed.

The current LLM boundary is `llm-bridge::complete-http(provider, base-url, path, headers, body) -> list<u8>`. Tractor owns provider credentials and performs the HTTP request on behalf of the WASM plugin. This is sovereign and safe, but buffered: the plugin receives bytes only after the host response completes.

Direct `wasi::http` from the plugin could expose chunked reads to pi-agent, but would also require giving provider credentials and route policy to the sandboxed plugin. That weakens the existing host-owned credential boundary.

## Decision

Keep provider credentials and route enforcement in the Tractor host. Do not enable provider `stream: true` via direct plugin `wasi::http` unless a later ADR explicitly accepts the credential/security trade-off.

The preferred streaming transport is a host-proxied extension of `llm-bridge` that preserves host-owned credentials and route checks while making SSE chunks observable before the final response completes.

This is not a WASM-only architectural constraint. The streaming core should stay target-agnostic where practical: native Tractor owns transport, buffering, validation, and persistence boundaries; WASM is the plugin packaging/isolation boundary that should benefit from the same core semantics rather than force all design choices. Generic transport/framing primitives (for example SSE frame buffering) should remain reusable outside LLM-specific code; only provider JSON interpretation and `AgentResponse` projection belong in the LLM streaming layer.

The exact WIT shape remains to be implemented in a later slice, but it must satisfy these constraints:

- plugin can correlate chunks to a prompt (`prompt_ref`) without exposing provider secrets;
- host continues to enforce provider/base-url/path/body policy;
- partial chunks become `AgentResponse` nodes with `is_final=false` and monotonic `sequence`;
- final response remains `is_final=true` and follows the last stored partial sequence;
- `streaming_reader_available()` flips to true only with tests proving end-to-end partial persistence.

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

This keeps `complete-http` as the default buffered primitive. `complete-http-stream` is opt-in and can be introduced without forcing non-streaming plugins to understand streaming.

## Consequences

### Positive Consequences

- Preserves the current security boundary: API keys remain in Tractor.
- Avoids a misleading implementation where `LLM_STREAM_RESPONSES=1` silently leaks credentials into plugin env.
- Keeps current buffered `complete-http` path intact for non-streaming and fallback compatibility.
- Makes the next implementation slice explicit: design and test a host-proxied streaming primitive rather than prematurely toggling provider `stream: true`.

### Negative Consequences

- Requires host/WIT changes before real streaming ships.
- The existing plugin-side callback seam cannot receive incremental network bytes until the host bridge is extended.
- Some SSE parsing/persistence logic may need to live at the host boundary or be shared to avoid duplication, depending on WIT callback feasibility.

## Alternatives Considered

- **Direct plugin `wasi::http` streaming:** rejected for now because provider credentials and route enforcement would move into the plugin sandbox.
- **Keep buffered `complete-http` and call the callback with final bytes:** already implemented as a seam, but it cannot deliver live token streaming.
- **Host stores partial CRDT nodes directly:** viable if WIT callbacks are awkward, but risks duplicating provider-specific SSE parsing outside pi-agent unless shared carefully.
