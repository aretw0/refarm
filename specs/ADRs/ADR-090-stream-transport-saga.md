# ADR-090: Streaming & Stream Transport (Saga Index)

**Status**: Accepted  
**Progress**: Index only — 053/054/055 remain the binding specs; this is their front door  
**Date**: 2026-07-12  
**Deciders**: Arthur Silva, Claude  
**Related**: [ADR-053](ADR-053-host-proxied-model-streaming.md), [ADR-054](ADR-054-generic-stream-observations.md), [ADR-055](ADR-055-stream-contract-v1-transport-layer.md), [ADR-088](ADR-088-agent-surface-transport-seam.md)

---

## Context

Three ADRs from 2026-05-02 tell one story in three incremental steps — each opens
by citing the previous — but there was no single entry that frames the arc. They are
all Accepted and heavily referenced by code, so this is an INDEX, not a merge: the
child ADRs stay the binding specs.

## The arc (each step owned by its child ADR)

1. **[ADR-053] Host-Proxied Model Streaming Boundary** — the model round-trip is
   proxied by the host so provider credentials never reach the guest; the host
   streams text + tool-call deltas back to the plugin.

2. **[ADR-054] Generic Stream Observations + AgentResponse Projection** — generalizes
   the streamed chunk beyond model output into `StreamChunk` / `StreamSession` graph
   nodes, so any producer's stream is observable, and projects `AgentResponse`.

3. **[ADR-055] stream-contract-v1 as a Separate Transport Package** — extracts the
   *how consumers receive chunks* into its own contract package (file / SSE / WS
   transports against one `StreamTransportAdapter`), which ADR-054 left open.

## How to read it

Streaming = **053 (boundary: credentials stay host-side) → 054 (generalize the chunk
to a graph observation) → 055 (package the transport)**. ADR-088 (agent surface
transport seam) builds on this: a new surface consumes these streams. This index
adds no new decision; each child keeps its own `Related: ADR-090` back-pointer so the
saga is navigable both ways.
