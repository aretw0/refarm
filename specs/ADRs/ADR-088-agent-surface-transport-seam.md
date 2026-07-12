# ADR-088: Agent Surface Transport Seam (Telegram / PWA / P2P)

**Status**: Proposed
**Date**: 2026-07-12
**Authors**: Arthur Silva, Claude
**Related**: ADR-075 (Pears as Distributed Runtime Reference), ADR-074 (Remote
Workspace Control Plane), ADR-085 (Open Surface Vocabularies), ADR-084 (Plugin
Dispatch Model), ADR-059 (Tractor Rust Authoritative Runtime),
`docs/decision-log.md`

---

## Context

The north star: an operator should be able to **talk to their agent from any
surface** — the terminal today, a Telegram chat to drive the machine while away,
a chat in a PWA, and — with no server between two devices — the *same*
experience over peer-to-peer. Surfaces must host and approve work; they must not
each re-own the runtime contract (the boundary ADR-074/ADR-075 already set).

ADR-075 already adopted **Pears/Holepunch** as a distributed-runtime *reference*
(portable core behind thin hosts; Bare/Hypercore/Hyperswarm as research, not
dependencies) and already names Telegram/Matrix/PWA/Android as future surfaces.
This ADR does **not** restate that. It records the second reference the operator
asked us to study, and — more importantly — it pins down the **concrete seam** a
new conversational surface plugs into today, and the two pieces that are missing
before Telegram/PWA/P2P are cheap to build. This is written so the references do
not have to be re-cited.

### Reference: peerd.ai (agent workstation in the browser)

Peerd is a close *conceptual mirror* of Refarm — useful precisely because it
converges on the same shape from a different starting point (the browser
extension as the harness). Its five primitives map almost one-to-one onto our
capability/verb model:

| Peerd primitive | What it is | Refarm analogue |
| --- | --- | --- |
| **Act** | DOM tools, inherits real sessions, no OAuth | capability verbs / `run()` |
| **Think** | model routing, sub-agent spawn, budget/permission | delegation + `Effort`, model routes, grants |
| **Compute** | JS notebooks (V8 isolates), WASI binaries, WASM Linux VMs | Tractor WASM host, plugin sandbox |
| **Build** | local app + reusable workflows | plugins / composition |
| **Share** | P2P capability exchange, signed content (`peerd://`) | content-addressed store by hash, grants |

Transport model worth stealing ideas from (not code): three-tier egress —
agent↔provider **HTTPS allowlist** (`safeFetch`, keys in the service worker),
agent↔web **HTTPS denylist** (`webFetch`, blocks banks/health), agent↔agent
**WebRTC direct + Kademlia DHT** with **stateless relays that only introduce
peers then leave the data path**, plus **gossip for offline messaging**.
Identity is **Ed25519 `did:key`**. The whole design is organized around denying
the "lethal trifecta" (private data + untrusted content + network) by keeping
those in separate sandbox contexts — the same instinct as our `SecurityMode::
Strict` + grants boundary.

**Limit for us**: peerd is Chromium/Firefox-extension-specific and does *not*
natively serve Telegram or mobile PWA. It is a reference for **security posture
and P2P agent-to-agent shape**, not a runtime to adopt. Where Pears gives us the
distributed-runtime/log/availability reference (ADR-075), peerd gives us the
**browser-native security + A2A** reference.

## The seam that already exists

A new conversational surface does **not** need new runtime plumbing. The
integration boundary is already there, in two layers:

1. **Sidecar HTTP `:42001`** — request/response + polling. Any surface submits
   work with `POST /efforts` and reads it back with `GET /efforts/:id`
   (`GET /nodes`, `GET /plugins`, `POST /sessions`, `POST /efforts/:id/cancel`,
   …). This is exactly what `refarm ask`/`chat` do. Canonical TS client:
   `@refarm.dev/sidecar-client`.

2. **WS daemon `:42000` + the event router** — conversational agent prompts. On
   a text frame `{ "type": "user:prompt", "agent": "<id>", "payload": … }`,
   `daemon/ws_server.rs` calls `deliver_via_router("user:prompt", Some(agent),
   payload)` (`packages/tractor/src/lib.rs`) — *the one shared implementation
   both `TractorNative::deliver` and the sidecar effort dispatcher call*. The
   `EventRouter` is just `event name → subscribed plugin_ids` (via
   `capabilities.subscribes`). `ws_server` is explicitly **no longer an
   agent-shaped producer bypassing the router** — it is one producer of
   `user:prompt` among equals.

So the rule is: **a surface is a producer that calls
`deliver_via_router("user:prompt", agent, payload)` (or `POST /efforts`) and
reads the reply back.** Telegram long-poll, a PWA WebRTC datachannel, and a P2P
stream all reduce to that.

The two open axes make this additive, not breaking: `CapabilityTransports`
(cli/repl/http/agent + `[key: string]`) and `CapabilityRenderers` (web/tui +
`[key: string]`) in `packages/capabilities/src/types.ts`; `surface-model.ts`
iterates them **without enumerating known keys** (ADR-085). A new transport or
renderer is a hint you can declare before its projector exists.

### Partial foundations already in the tree

- **Outbound channel governance**: `channel-policy-v1` (`ChannelDeliveryEnvelope`,
  rate-limit, review-gate, `ChannelDestinationRef`) + `dispatch-surface`
  channels (`POST /channels/:channel/efforts`, `buildChannelEffort`,
  `resolveChannelControlSurfaceAdapter` in `apps/farmhand/src/transports/
  channels.ts`). This is where a governed "Telegram channel" (rate-limited,
  review-gated outbound) slots in — the contract + generic adapter exist; **no
  concrete channel is implemented.**
- **PWA shell scaffolding**: `apps/me/src/lib/me-pwa.ts` (`registerRefarmMePwa`,
  service worker) is real — the seed of the chat-PWA host.
- **Runtime stream transports** already model "one contract, three transports":
  `file-stream-transport`, `sse-stream-transport`, `ws-stream-transport` against
  `stream-contract-v1`.

## What is missing (the two real gaps)

1. **No first-class Rust `Transport` trait for *agent-prompt* ingress.** Today
   the trigger is the **ad-hoc pair** `ws_server.rs` + `deliver_via_router`. It
   is the *only* producer of `user:prompt`. A `TelegramTransport` today means
   replicating that producer (a new Rust producer, or an external TS service
   hitting `:42001`/`:42000`) rather than implementing one clean interface. The
   canonical fix: a small `Transport` seam whose contract is "receive a message
   from my medium → `deliver_via_router(user:prompt, agent, payload)` → stream
   the reply back", so ws/Telegram/PWA/P2P are N implementations of one trait.

2. **No generic per-transport text *response* channel.** The sidecar exposes no
   SSE/WS *reply* endpoint; replies are written to `streams_dir/*.ndjson` and
   **polled from the filesystem** (fine for a co-located CLI, wrong for a remote
   Telegram bot or a P2P peer). The `ws_server` broadcast is binary-CRDT, not
   text answers. A surface-neutral reply channel (subscribe to an effort's
   stream over the same transport that submitted it) is the missing half.

Both gaps are consistent with ADR-075's "typed seams beat improvised control
messages" and ADR-059's "the orchestrator owns translation; the Rust host stays
imperative."

## Decision

1. Treat **the sidecar `:42001` + the `user:prompt` router seam** as the
   supported integration boundary for all new agent surfaces. Surfaces are
   producers/consumers around it; they do not embed the runtime contract. (Makes
   ADR-075's "thin hosts" concrete.)
2. Adopt **peerd.ai** as a named reference for **browser-native security posture
   and agent-to-agent P2P shape**, complementary to Pears (ADR-075) for the
   distributed-runtime/log/availability shape. Reference only — **zero
   dependencies**, same proof-gated posture as ADR-075.
3. Sequence the surface work by **cost, cheapest first**, and only build the two
   missing seams when a concrete surface pulls them:
   - **Telegram first** (no P2P): an ingress producer (bot long-poll/webhook →
     `POST /efforts` or `deliver_via_router`) + a text reply channel; reuse
     `channel-policy-v1` for governed outbound. This is the forcing function
     that justifies gap (1) and gap (2).
   - **PWA next**: promote `apps/me` PWA shell to host the existing Homestead web
     face as an installable chat; still over `:42001`/WS `:42000`.
   - **P2P last**: the *same* PWA experience peer-to-peer stays **aspiration
     (ADR-075)** until a contained proof + consumer pressure justify a real DHT/
     NAT-traversal substrate. `peerId` in the tree today is a **CRDT actor id**,
     not a network identity; the only real "peer" is a **CRDT-binary relay over
     WS on the LAN**. Do not claim P2P reach without seed/replica evidence.

## Non-goals

- Do not add a P2P networking dependency (libp2p/hyperswarm/holepunch) before a
  focused proof — unchanged from ADR-075.
- Do not build a Telegram/PWA surface before the `user:prompt`/reply seam it
  needs is designed; the surface is the forcing function, not the plumbing.
- Do not let any surface accumulate control-plane logic (ADR-074/ADR-075).
- Do not rename Refarm concepts to peerd concepts.

## Consequences

**Positive**: the path from "agent runs locally" to "talk to it from Telegram/
PWA/P2P" is now a named seam with two well-scoped gaps, not a vague horizon. Both
references (Pears distributed-runtime, peerd browser-security/A2A) are recorded
so they need not be re-cited. Surfaces stay thin by construction.

**Risks**: the compelling peerd/Pears stacks invite premature adoption
(mitigation: reference-only, proof-gated, same as ADR-075). "P2P" can become
vague product language (mitigation: the CRDT-actor-id vs network-identity
distinction is written here; require seed/replica evidence before any P2P
claim).

## References

- ADR-075 (Pears distributed-runtime reference) — the distribution/log/
  availability half; not restated here.
- Peerd: <https://peerd.ai> — browser-native agent workstation; Ed25519
  `did:key`, WebRTC+DHT A2A, stateless relays, safeFetch allowlist.
- Pears: <https://pears.com>, <https://docs.pears.com> (see ADR-075 for the
  stack breakdown).
- Seam in-tree: `packages/tractor/src/lib.rs` (`deliver_via_router`),
  `packages/tractor/src/daemon/ws_server.rs` (`user:prompt`),
  `packages/tractor/src/sidecar/mod.rs` (HTTP `:42001`),
  `packages/capabilities/src/types.ts` (open transport/renderer axes),
  `packages/channel-policy-v1`, `apps/farmhand/src/transports/channels.ts`,
  `apps/me/src/lib/me-pwa.ts`.
