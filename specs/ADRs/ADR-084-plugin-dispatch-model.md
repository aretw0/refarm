# ADR-084: Plugin Dispatch Model — Async-Default, Sync-Negotiated

**Status**: Accepted
**Date**: 2026-07-05
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-059 (Tractor Rust as Authoritative Runtime), ADR-083 (Canonical
Plugin WIT Contract), `packages/refarm-plugin-wit`, `packages/agent`,
`packages/tractor`, `packages/vault-surface-ref`

---

## Context

Every refarm plugin exports the same canonical `integration` interface
(`refarm:plugin@0.1.0`): `setup`/`ingest`/`push`/`teardown`/`get-help-nodes`/
`metadata`/`on-event`/`respond`. As the first non-agent plugin (`vault:v1`) began
running on the real runtime, one question had to be answered for the whole
ecosystem, not just the vault: **how does a plugin return its result?**

Three models were on the table, and the choice is load-bearing — it shapes every
future plugin:

- **Synchronous** — a live `respond` call the host awaits, putting the returned
  value in the response body.
- **Asynchronous** — `on-event` triggers work; the result is emitted through the
  `tractor-bridge` (a persisted node / `.ndjson` stream) and read back by polling.
- **Both** — offer both and let plugins choose.

The decision was made from source evidence with adversarial refutation of each
model (workflow `wf_81785b05`).

### The one real data point

The **agent** — the only production plugin — already chose **asynchronous**, and
it works. A prompt arrives as `on-event('user:prompt')`; the agent does **not**
return inline (`on-event` returns nothing). It writes the answer as `is_final`
`.ndjson` chunks to a per-request stream file keyed by `stream_ref`
(`packages/agent/src/runtime/prompt_handler.rs`) and persists `AgentResponse`
CRDT nodes. The caller reads the answer out of band by polling the stream "without
holding a connection open" (`packages/tractor/src/sidecar/mod.rs`). Streaming,
crash-resilience (the result survives a dropped connection), and long tool-loops
all fall out for free.

The `respond` WIT export exists and the agent implements it, but it is **provably
dead** on the real path: `FNDA:0`, zero host callers, no `call_respond` on
`PluginInstanceHandle`; the runner loop only pumps `on-event` and `teardown`.

## Decision

**Asynchronous dispatch is the DEFAULT for every plugin. Synchronous `respond` is
a secondary, capability-NEGOTIATED opt-in — not a free choice.**

- Every plugin is async by default: `on-event` triggers work, results are emitted
  through the bridge, callers read them back. This is what already ships and works.
- A plugin MAY additionally support synchronous `respond`, but only by
  **advertising a capability flag in `metadata()`**. The host reads that flag and
  dispatches synchronously ONLY to plugins that declare it. A plugin without the
  flag is **never** called via `respond` — a caller requesting sync from an
  async-only plugin gets a clean host-level `not-supported` error, never a hung
  connection.
- The sync-vs-async decision therefore lives in a **negotiated flag the host
  enforces**, not as an open choice in the plugin contract. This is deliberately
  NOT "let plugins choose freely."

### Per-verb, not per-plugin, where a plugin has mixed verbs

A verb whose answer already exists and is small (a search returning hits, a lint
returning findings, a status lookup) SHOULD be synchronous — a typed return, no
correlation ceremony. A verb whose answer must be computed, streams, loops tools,
or may outlive the caller MUST be asynchronous. A plugin does not implement both
shapes for the same verb; each verb picks one and advertises it. This suggests the
capability flag needs **per-verb granularity** in `metadata()`.

## Consequences

### Why not sync-only

The flagship workload (the agent) is inherently a stream plus tool-loop fan-out
that a single blocking string return cannot express. The wasmtime `Store` is
`!Send`, so each plugin runs on its own thread inside `LocalSet.block_on` — even a
"sync" call must hop threads through a oneshot, paying the channel cost without
gaining in-place synchrony. And a held connection loses the crash-resilience that
fs-persisted results give for free. Sync-only would force every future plugin down
a blocking path that is wrong for the agent-class workloads the ecosystem exists to
promote.

### Why not async-only (as the sole model)

Trivial request-reply verbs should not inherit the agent's distributed-systems
tax: minting a request id, re-deriving the `prompt_ref → stream_ref` URN formula
(a naming convention the host does not enforce), polling, and reading the
sidecar's optimistic `done` with `result: None` while the real answer is computed
elsewhere. If the ceremony exceeds the plugin's logic, the ecosystem never grows
simple plugins.

### Why not "both, let them choose and suffer"

"Both" already exists in the WIT and its sync half is a corpse. Promoting it to a
free choice is strictly worse: every consumer carries two branches (hold-the-
connection AND poll-the-stream), every plugin carries a dead stub, there is no
capability handshake, the host maintains two mechanisms forever, and authors are
tempted to fake-sync (a `respond` that internally fires `on-event` and blocks).
"Choose and suffer" fragments the ecosystem. The negotiated flag is what makes
"both" safe: it is not a free choice, it is a declared, host-enforced capability.

### Cost and boundary

- The async default already ships. Extending a plugin's async verbs is **not `§8`**
  (plugin + bridge only).
- Synchronous `respond` is **`§8`**: a `call_respond` arm on `PluginInstanceHandle`,
  a request-with-oneshot-reply variant in the runner loop
  (`packages/tractor/src/lib.rs`), a sidecar branch that awaits the oneshot and
  puts the string in the response body (instead of firing mpsc with `result: None`),
  and the metadata capability flag the host reads. It follows the serialized
  lock/handoff policy for `packages/tractor`. The plugin-side `respond` is already
  implemented, so there is no per-plugin cost beyond declaring the flag.

### Known debts of the current async model (to attack as adoption grows)

The recon surfaced six debts of the async path — of the HOST, not any one plugin:

1. **Correlation is convention, not contract** (prioritized as the next slice):
   `stream_ref` is a string formula honored by exactly one plugin today; a second
   plugin with a typo desyncs silently with no host error. The host should DERIVE
   and OWN `stream_ref` (enforced), not leave it to convention.
2. No GC/TTL for accumulating `.ndjson` stream files and result nodes.
3. The sidecar's optimistic `finalise(done, result: None)` is a success lie —
   consumers cannot distinguish real success from fire-and-forget.
4. No typed return channel — every async result degrades to untyped `.ndjson` the
   caller hand-parses.
5. Timeout/cancellation has no home — a caller that stops polling leaves the
   producer running and the effort store lying.
6. Capability granularity for sync (per-verb vs per-plugin) must be decided when
   the sync path is built.

## Validation (e2e to prove the model before committing)

- Real `load_plugin` of a plugin over the real bridge; `metadata()` lists the
  `respond` capability flag and its sync verbs; a plugin omitting the flag is never
  dispatched to `call_respond`.
- Sync round-trip: a `search`/`profile` effort for a respond-capable plugin returns
  a typed JSON string in the response body, no `.ndjson` written.
- Async round-trip: an `extract` effort is marked active, then reconstructed by
  tailing the fs `.ndjson` at the derived `stream_ref`.
- Correlation determinism for a SECOND plugin (the vault), not only the agent.
- Crash-resilience: drop the connection mid-async-turn; a later reader replays the
  same `.ndjson` and gets the complete result.
- Negation guard: sync requested from an async-only plugin gets a clean
  `not-supported`, never a hung connection or a fabricated `done`.
