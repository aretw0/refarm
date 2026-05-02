<!-- mdt template — run `mdt update` from docs/diagrams/ to sync, `mdt check` in CI -->

<!-- {@layer-full} -->
**Source**: [`layer-diagram.mermaid`](./layer-diagram.mermaid)

![Full Layer Diagram](./layer-diagram.svg)
<!-- {/layer-full} -->

<!-- {@layer-distros} -->
**Source**: [`layer-diagram--distros.mermaid`](./layer-diagram--distros.mermaid)

![Distros layer](./layer-diagram--distros.svg)

> The 3 distros and how each connects to the dual-runtime Tractor core.
> `apps/dev` + `apps/me` use **tractor-ts** (browser/Node via JCO).
> `apps/refarm` calls **Farmhand** over HTTP port 42001.
<!-- {/layer-distros} -->

<!-- {@layer-runtime} -->
**Source**: [`layer-diagram--runtime.mermaid`](./layer-diagram--runtime.mermaid)

![Runtime layer](./layer-diagram--runtime.svg)

> The execution engine: dual-runtime Tractor (TS + Rust), the WIT contract interface,
> and the plugin sandbox where `.wasm` components run.
> Both runtimes share the **same WIT** (`refarm:plugin@0.1.0`) — no divergence possible.
<!-- {/layer-runtime} -->

<!-- {@layer-data} -->
**Source**: [`layer-diagram--data.mermaid`](./layer-diagram--data.mermaid)

![Data layer](./layer-diagram--data.svg)

> Capability contracts that Tractor uses for persistence, CRDT sync, and identity.
> Each contract has pluggable adapters — **storage-sqlite** (OPFS + Loro CRDT state),
> **sync-loro** (ADR-045 Loro engine), **identity-nostr** (Nostr keypair + relay).
<!-- {/layer-data} -->

<!-- {@layer-streams} -->
**Source**: [`layer-diagram--streams.mermaid`](./layer-diagram--streams.mermaid)

![Streams layer](./layer-diagram--streams.svg)

> Task dispatch and CRDT streaming from Farmhand.
> **effort-contract-v1** routes tasks via FileTransport (NDJSON) or HttpTransport.
> **stream-contract-v1** broadcasts CRDT deltas via File, SSE, or WebSocket transport.
<!-- {/layer-streams} -->
