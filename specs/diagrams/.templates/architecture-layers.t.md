<!-- mdt template — run `mdt update` from specs/diagrams/ to sync, `mdt check` in CI -->

<!-- {@arch-full} -->
**Source**: [`architecture-layers.mermaid`](./architecture-layers.mermaid)

![Architecture Layers](./architecture-layers.svg)
<!-- {/arch-full} -->

<!-- {@arch-apps-runtime} -->
**Source**: [`architecture-layers--apps-runtime.mermaid`](./architecture-layers--apps-runtime.mermaid)

![Apps and runtime layer](./architecture-layers--apps-runtime.svg)

> The execution path from distros to the plugin sandbox.
> All 4 apps route through the dual-runtime Tractor core, which exposes a single WIT contract
> (`refarm:plugin@0.1.0`) shared by both `tractor-ts` (JCO) and `tractor` (wasmtime).
> Plugins run in an isolated `.wasm` sandbox on either runtime.
<!-- {/arch-apps-runtime} -->

<!-- {@arch-contracts} -->
**Source**: [`architecture-layers--contracts.mermaid`](./architecture-layers--contracts.mermaid)

![Capability contracts](./architecture-layers--contracts.svg)

> The five capability contracts that mediate all cross-cutting concerns.
> Tractor cores never touch storage, sync, or identity directly — they go through contracts.
> Farmhand routes tasks via `effort-contract-v1` and broadcasts CRDT deltas via `stream-contract-v1`.
<!-- {/arch-contracts} -->

<!-- {@arch-adapters} -->
**Source**: [`architecture-layers--adapters.mermaid`](./architecture-layers--adapters.mermaid)

![Transport and storage adapters](./architecture-layers--adapters.svg)

> Concrete adapter implementations plugged behind each contract at runtime.
> Transport adapters: `FileTransport` (NDJSON tasks), `HttpTransport` (port 42001), SSE/WS streams.
> Storage adapters: `storage-sqlite` (OPFS + Loro CRDT), `storage-memory` (tests), `identity-nostr`.
<!-- {/arch-adapters} -->
