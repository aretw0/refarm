# The sovereign record's read order — an invariant that cost more to find than to fix

> Fixed 2026-08-06 in `packages/tractor/src/storage/sqlite.rs` (`query_nodes` /
> `query_nodes_limited` / `count_nodes`). Plan:
> `.superpowers/sdd/2026-08-06-the-record-reader-goes-blind/`. Diagram:
> [`specs/diagrams/record-read-path.mermaid`](../specs/diagrams/record-read-path.svg).
>
> Two more consumers fixed 2026-08-06, later the same day, in a follow-on plan: the
> WASM bridge's `query-nodes` host call
> (`packages/tractor/src/host/wasi_bridge/core.rs`, commit `8bf5d345`) and the
> agent's two session helpers (`packages/agent/src/session/wasm_ops.rs`, commits
> `54642ffb` and `1ca1f08f`). Plan:
> `.superpowers/sdd/2026-08-06-the-contract-reaches-every-consumer/`. Proven on node
> `sede`: loaded/built plugin hash moved `544ef5b4` → `cff89975`, harness session
> tests 3/3, `refarm budget observations --limit 1` unregressed at `stored: 29,
> truncated: true`.
>
> The guest-side gap named below ("the guest has no truncation signal") was closed
> 2026-08-06, later the same day, in a third plan: `query-nodes`'s WIT signature
> changed in place — a breaking change to the versioned package `plugin:host@0.1.0`
> — to return a `node-page` record (`nodes`, `stored`, `truncated`) instead of a bare
> `list<json-ld-node>` (`packages/plugin-wit/wit/host.wit`, commit `89332598`), and
> the agent's budget guard was rewritten to use the new signal instead of discarding
> it (`packages/agent/src/session/pure.rs`, `packages/agent/src/session/wasm_ops.rs`,
> commits `5a9bd759`, `65e38f10`, `576cfc02`, `d77a614c`). See "The guest gets a
> truncation signal" below. Plan:
> `.superpowers/sdd/2026-08-06-the-guest-can-tell/`. Proven on node `sede`:
> loaded/built plugin hash moved `cff89975` → `50483c6c`, harness session tests 3/3,
> `refarm sessions list --json` resolving, `refarm budget observations --limit 1`
> unregressed at `stored: 29, truncated: true`.

## The invariant

`NativeStorage::query_nodes(type_)` and `NativeStorage::query_nodes_limited(type_, limit)`
return rows of a given `@type` **newest first**, with `id DESC` as a total-order tiebreak
on top of `updated_at DESC`. In SQL:

```sql
SELECT id, type, context, payload, source_plugin, updated_at
FROM nodes WHERE type = ?1
ORDER BY updated_at DESC, id DESC
[LIMIT ?2]
```

Every caller in this repository that takes the first `N` rows of a `query_nodes*` result
is asking for **the N most recent** — not "N rows, order unspecified." That is the
contract this ordering exists to hold, and it is enforced in one place
(`query_nodes_inner`, `packages/tractor/src/storage/sqlite.rs:233-268`) so every reader
inherits it instead of re-deriving it.

## Why it exists — the measurement

Before 2026-08-06, `query_nodes`'s `SELECT` had **no `ORDER BY` at all**. SQLite is free to
return rows in whatever order it finds convenient for an unordered query — in practice,
insertion order, oldest first.

Measured on the operator's own node before anything was written, against a real
29-observation `BudgetObservation` record:

```
refarm budget observations --limit 1 --json
```

returned the observation timestamped `2026-08-03T21:21:48` — the **oldest** of the 29 —
while the newest observation in the same store was timestamped `2026-08-05T17:29:36`.
`--limit 1` is documented, and read by every caller, as "the most recent one." This
returned the exact opposite. Not a degradation, not an edge case at some limit boundary —
the flag's basic meaning was inverted on every call.

The cause generalised past this one command. **Nine** call sites took from the **front** of
an unordered `Vec<NodeRow>`, each meaning "the most recent N" — five identified when this
was first traced, plus four more found on review that reach the same WASM bridge call from
`packages/agent/src` and `packages/delegate/src` and were missing from the first count. A
tenth row, `GET /tasks`, is added below: it does not share the original nine's
plain-`.take(n)` shape (it materialises unlimited, re-sorts, then truncates — worse, not
the same bug), and it is included because it demonstrably disagrees with its guest sibling
`list_tasks` today, not because it fits the original count:

| Caller | File | What it meant to read | Fixed |
| --- | --- | --- | --- |
| `GET /nodes?type=…` (→ `refarm budget observations`) | `packages/tractor/src/sidecar/mod.rs` | the newest page of a type | Yes — 2026-08-06, predecessor plan |
| The WASM bridge's `query-nodes` host call | `packages/tractor/src/host/wasi_bridge/core.rs` | the newest N a plugin asked for | Yes — 2026-08-06, this plan (`8bf5d345`) |
| `latest_session_id_with_v1_preference` | `packages/agent/src/session/wasm_ops.rs:45-53` | the current session | Yes — 2026-08-06, this plan (`54642ffb`) |
| `latest_session_leaf_id` | `packages/agent/src/session/wasm_ops.rs:87-95` | the session's most recent leaf entry | Yes — 2026-08-06, this plan (`1ca1f08f`) |
| (transitively) conversation history fallback | `packages/agent/src/session/wasm_ops.rs:198-251` | recent turns | Yes, transitively, for its preferred path — see below |
| `list_tasks` | `packages/agent/src/tool_dispatch/task_tools.rs:8` | the newest N tasks | No |
| `task_status`'s `TaskEvent` lookup | `packages/agent/src/tool_dispatch/task_tools.rs:44` | this task's recent events | No |
| `task_context_for_prompt` | `packages/agent/src/runtime/policy.rs:128` | the newest N tasks for prompt context | No |
| `load_personas` | `packages/delegate/src/lib.rs:230` | the available personas | No |
| `GET /tasks` (→ `refarm tasks`) | `packages/tractor/src/sidecar/mod.rs:1703-1758` (`get_tasks`) | the newest N tasks | No — and unlike the four rows above, this one is a live bug today, not a deferred cost. See below. |

**`GET /tasks` is the sharpest of the rows still marked "No," and it disagrees with its
own guest sibling today.** `get_tasks` (`packages/tractor/src/sidecar/mod.rs:1718,1747,1752`)
still holds all three shapes this document's fixes removed elsewhere: an unlimited
`storage.query_nodes("Task")` with no `LIMIT` pushed into SQL (line 1718, never
`query_nodes_limited`), a second, re-derived sort order —
`tasks.sort_by(|a, b| b["created_at_ns"]...cmp(&a["created_at_ns"]...))` (line 1747), the
exact "second sort order" shape "What a caller must do" forbids — and a silent
`tasks.truncate(params.limit.min(100))` (line 1752) returning `{tasks, total}` with no
`stored`/`truncated`, the same shape `GET /nodes` had before its fix. Its guest sibling,
`list_tasks` (`packages/agent/src/tool_dispatch/task_tools.rs:3-27`), calls
`tractor_bridge::query_nodes("Task", limit)` — the fixed WASM bridge — which now takes the
front N in the storage layer's `updated_at DESC, id DESC` order. `GET /tasks` orders by
`created_at_ns` instead. For any Task whose status has changed since it was created (the
ordinary case — a Task is created `active` and later updated to `done`/`failed`/`blocked`),
`created_at_ns` and `updated_at` diverge, so the two surfaces can, and do, return a
different "newest N tasks" for the identical underlying data — the same
created-versus-touched divergence just fixed for Session (see above), live in the same
file as the `get_nodes` handler that was fixed. The two surfaces disagree today; this row
is named here so the next reader does not have to rediscover it.

**How the two 2026-08-06 fixes worked, and why 4 rows above stayed "No" without being
wrong.** The bridge fix (`8bf5d345`) was a cost fix, not a correctness fix: the
predecessor plan's `ORDER BY` already made `sync.query_nodes(&node_type)`'s result
newest-first, so the old `.take(limit as usize)` after it was already selecting the
right N rows — just after loading every row of the type to get them.
`TractorBridgeHost::query_nodes` now calls `self.sync.query_nodes_limited(&node_type,
limit as usize)` instead, pushing `LIMIT` into SQL. `NativeSync`
(`packages/tractor/src/sync/loro.rs`) had a `query_nodes` passthrough to
`NativeStorage` but no `query_nodes_limited` one, despite `NativeStorage` already
having both from the predecessor plan; the passthrough was added. `host.wit`'s
`query-nodes` signature did not change. `list_tasks`, `task_status`'s `TaskEvent`
lookup, `task_context_for_prompt`, and `load_personas` all call this same host
function (`tractor_bridge::query_nodes`) and inherited the lower cost the moment the
host was rebuilt, with no guest-side code of their own changing — they stayed "No"
above because none of them had ever re-sorted; there was no correctness bug in them to
fix, only a cost fix upstream of them to inherit.

The two session-helper fixes (`54642ffb`, `1ca1f08f`) were correctness fixes, and a
different kind of bug from the bridge's: `latest_session_id_with_v1_preference` and
`latest_session_leaf_id` each re-derived "newest" with their own
`max_by_key(created_at_ns)` scan over rows the storage layer had already ordered by
`updated_at DESC, id DESC` — the second, disagreeing sort order "What a caller must
do" above forbids, and one answering a different question besides (newest-*created*,
not newest-*touched*; Session rows are UPSERTED on append, so those diverge). Both
re-sorts are gone; both functions now trust the storage layer's order outright. Because
`wasm_ops.rs` is `#[cfg(target_arch = "wasm32")]` and not natively testable, the pure
selection logic was extracted to `session::pure::pick_latest_session_id` and
`pick_latest_session_leaf_id` (a `cfg`-unconditional module) and unit-tested there,
with fixtures that deliberately make newest-touched and newest-created disagree so the
tests can only pass by trusting the storage layer's order, not by coincidence.

The "(transitively)" row: `query_history_from_session` — the *preferred* path
`query_history` takes when a Session exists — calls `latest_session_leaf_id(10)`
directly (`wasm_ops.rs:199`) and inherits its fix with no code change of its own.
`query_history`'s legacy fallback (`wasm_ops.rs:246-250`, timestamp-sorting
pre-session `UserPrompt`/`Response` nodes for the case no Session exists yet) is a
different code path that this plan did not examine and makes no claim about here.

The sidecar reader made the ceiling worse than a wrong first page: it capped the response
at `.take(limit.min(100))` **after** materialising the unordered rows. Past 100 stored
records of a type, no `--limit` value the caller chose could ever surface a record newer
than whatever happened to land in the first 100 by insertion order — the record was
permanently blind to anything written after that point, at any limit.

## How it was found — the reusable part

Not by reading the SQL. `SELECT id, type, context, payload, source_plugin, updated_at FROM
nodes WHERE type = ?1` reads as an ordinary query, and it had looked fine to everyone who
read it before this — including the code review that approved the sidecar and the WASM
bridge when they were written. There was nothing locally wrong to notice.

It was found by a **whole-plan review** asking a symptom-level question — *why can a cost
audit not see recent records?* — and tracing that backwards through the read path until it
reached the one query every reader shared. The lesson is the method, not the bug: a
missing `ORDER BY` is invisible from inside the query and from inside any single caller;
it is only visible from the outside, by asking why the thing built on top of all the
callers together disagrees with reality. Grepping for `ORDER BY`'s absence would not have
found this either — nothing was there to grep for.

## What a caller must do

- **Prefer `query_nodes_limited(type_, n)` over `query_nodes(type_)` whenever only the
  newest few rows are wanted.** `query_nodes` materialises every row of that type before
  the caller discards the rest — affordable at 29 rows, not at 29,000. The limit belongs
  in the `LIMIT ?2` clause, not in a `.take(n)` after the fact (`sidecar/mod.rs`'s
  `get_nodes` handler is the reference: `storage.query_nodes_limited(type_, effective_limit)`,
  never `query_nodes(...).take(n)`).
- **Never re-sort in the caller to re-answer the question the storage layer already
  answered.** The ordering guarantee is established once, in `query_nodes_inner`, and it
  answers one specific question — which row was touched most recently
  (`updated_at DESC, id DESC`). A caller that re-derives *that same* answer by its own
  comparison (a second `max_by_key` on a timestamp field, a second sort by a different
  recency key such as a raw `created_at_ns`) creates a **second sort order** next to the
  first one, over the same data, purporting to answer the same question. Two sort orders
  over the same data are exactly how two answers drift apart — the moment their tiebreak
  rules diverge (as `updated_at` second-resolution and a raw `created_at_ns` field already
  can), the two paths can legitimately disagree about which row is "the latest," and
  nothing will flag it because both answers are locally correct by their own rule. This is
  what `latest_session_id_with_v1_preference` and `latest_session_leaf_id` did before their
  2026-08-06 fix (see the affected-reader table above), and it is what `GET /tasks`'s
  `get_tasks` (`packages/tractor/src/sidecar/mod.rs:1747`) still does today against its
  guest sibling `list_tasks` (see the affected-reader table above) — both re-derive
  "newest" from `created_at_ns`,
  disagreeing with `updated_at DESC` the moment a row's status changes after it was
  created. One ordering, established in one place, is what keeps *that* question from ever
  having two competing answers.

  That is narrower than "never sort in a caller," and two call sites in this codebase
  legitimately do sort after fetching without violating it, because each is answering a
  **different** question than "which row is most recently touched" — one the storage
  layer's recency order was never asked and does not claim to answer.
  `packages/agent/src/session/pure.rs:77`'s `history_from_nodes` sorts UserPrompt/Response
  rows by each payload's own `timestamp_ns` field, ascending, to reconstruct
  **conversation order** — a question about content sequence, not about which row was
  touched last. `packages/tractor/src/readers.rs:67-92`'s `cli_node_order`/
  `cli_node_time_key` sort CLI output by a timestamp read from the payload (`timestamp_ns`,
  or `updated_at_ns`, or `started_at_ns`, whichever the node type carries), with
  `sequence` as a tiebreak — a **domain display order** across heterogeneous node types
  that the storage layer's single `updated_at` column cannot express by itself. Neither
  site re-derives "the newest N rows of this type" as a substitute for
  `query_nodes_limited`'s `LIMIT`; both consume payload fields, after the storage layer has
  already done its own job, to answer a question specific to what they are building — not
  to second-guess which row the storage layer considers most recent.
- **A count is not a scan.** If a caller needs "how many rows of this type exist" alongside
  a limited page, call `count_nodes(type_)` (`SELECT COUNT(*)`) rather than
  `query_nodes(type_).len()` — the latter is exactly the materialise-everything cost
  `query_nodes_limited` exists to avoid, reintroduced one line below the fix.

## What a response means now

`GET /nodes?type=…` (`packages/tractor/src/sidecar/mod.rs::get_nodes`) returns, alongside
`nodes`:

| Field | Meaning |
| --- | --- |
| `total` | rows in **this** response (`nodes.len()`) — unchanged meaning, matches `summary.total` / `history.total` / `cache.total` elsewhere in the codebase |
| `stored` | the true count of rows of this `@type`, via `count_nodes` — independent of `limit` or the server's own `MAX_NODES_PER_RESPONSE` (100) ceiling |
| `truncated` | `stored > nodes.len()` — `true` only when the caller's limit (or the ceiling) actually left rows out |

A ceiling on response size (`MAX_NODES_PER_RESPONSE = 100`, `sidecar/mod.rs:1521`) is a
reasonable thing for an HTTP endpoint to have — an unbounded response is its own hazard.
A **silent** ceiling is not: before this fix, `.take(limit.min(100))` capped the page with
no signal that anything was left out. `stored`/`truncated` are how the response says
"there is more" instead of letting a caller infer completeness from a number that never
distinguished "this is everything" from "this is a slice."

**`stored` and `truncated` can be absent, and absent does not mean anything.** A sidecar
built before 2026-08-06 omits both keys from `GET /nodes`'s JSON body — that is a live
case, not a hypothetical one: any node running an older build produces exactly this
response shape today. `apps/refarm/src/commands/budget.ts`'s
`budgetObservationsPageFromBody` (lines ~254-274) keeps `stored`/`truncated` as
`number | undefined` and `boolean | undefined` respectively, with **no default**. A
caller must handle three states — truncated, confirmed complete, and *unknown* — not
two. See the next section for why collapsing that third state was the recurring bug in
this same session.

The TS graph client (`packages/sidecar-client/src/index.ts`, fixed 2026-08-06, commit
`d732a4f4`) carries this same discipline into `SidecarGraphClient.queryNodes`:
`QueryGraphNodesResult { nodes, stored?, truncated? }`, populated only by `typeof
body?.stored === "number"` / `typeof body?.truncated === "boolean"` checks — no `??`
fallback anywhere on the sidecar-HTTP path. Before this fix `queryNodes` returned a
bare `SidecarGraphNode[]` and threw the sidecar's `stored`/`truncated` away entirely,
so every TS consumer of the graph client was back to a truncated answer
indistinguishable from a whole one, one layer above the fix "What a response means
now" describes.

### A defaulting that looks like the defect this document exists to prevent, and is not

`apps/refarm/src/utils/tractor-store.ts`'s direct-sqlite adapter
(`tractorGraphFromNodeView`, added in the same 2026-08-06 fix) reports `stored:
nodes.length, truncated: false` for every query. Read out of context, that is exactly
the invented-default shape the paragraph above forbids — a `stored`/`truncated` pair
the client made up rather than one the server said. It is not that defect here, and
the distinction was established by reading the SQL rather than assumed:
`TractorNodesReadProvider.query`
(`packages/storage-sqlite/src/tractor-nodes-read.provider.ts:47-55`) builds its
statement as `SELECT id, type, payload, updated_at FROM nodes [...] ORDER BY
updated_at ASC` — no `LIMIT` clause, ever. That code path reads every stored row of
the requested `@type` in one pass, so `stored: nodes.length` is the true count and
`truncated: false` is true, both **by construction** rather than by assumption — the
same distinction `apps/refarm/src/commands/budget.ts` draws against the sidecar's `GET
/nodes`, which does apply a limit and the `MAX_NODES_PER_RESPONSE` ceiling below. The
two code paths return the identically-shaped `{ nodes, stored, truncated }` at the TS
call site and are not identical underneath.

That correctness rests on an invariant, not a guarantee: nothing stops
`TractorNodesReadProvider.query` from gaining a `LIMIT` in the future. The invariant is
documented inline (in `tractor-store.ts`'s `tractorGraphFromNodeView` doc comment) and
enforced by nothing — no test fails if `query` grows a limit tomorrow, and `stored:
nodes.length, truncated: false` would then silently become exactly the invented
default this whole document exists to eliminate, one layer downstream of where anyone
would think to look for it.

## The tiebreak is load bearing — and it is not uniform across the codebase

`updated_at` has **second** resolution (`datetime('now')` in SQLite). Two rows written in
the same wall-clock second are indistinguishable by `updated_at` alone, so `id DESC` is
what makes the order a **total order** — without it, two reads of the same unchanged data
could disagree about which of two same-second rows comes first, and a paging reader could
see rows shift under it between calls.

Whether that `id DESC` tiebreak is *deterministic* depends entirely on how the `id` was
minted, and this repository does it two different ways:

- **Monotonic.** `packages/agent/src/utils.rs:516-523`'s `new_id()`:

  ```rust
  pub(crate) fn new_id() -> String {
      let seq = SEQ.fetch_add(1, Ordering::Relaxed);
      let hex = format!("{:016x}{:04x}", now_ns(), seq);
      // + "urn:sovereign:resp-" prefix (via mint_urn), or urn:farmhand:<agent_id>: if MODEL_AGENT_ID is set
      ...
  }
  ```

  A nanosecond timestamp plus an `AtomicU64` counter, zero-padded into hex. `{:04x}` is a
  **minimum** width, not a fixed one — it pads short values up to 4 digits, it does not cap
  long ones. Past 65,535 ids minted in one process, the counter portion widens past 4
  characters, so "fixed-width hex" stops holding; the *sort order* survives that (a wider
  numeral still compares correctly against a narrower one under lexicographic `id DESC`,
  because both are left-padded onto the same 16-hex-digit timestamp prefix), but the
  width itself is not fixed.

  That numeric-sort guarantee also does not survive a varying **prefix**. With
  `MODEL_AGENT_ID` set, `new_id()` returns `urn:farmhand:<agent_id>:<hex>` instead of bare
  hex — `id DESC` across two different agent ids then sorts by `agent_id` first, and the
  timestamp only breaks ties *within* one agent. `Session` ids are a live example of the
  same problem: `packages/agent/src/session/wasm_ops.rs` mints
  `urn:sovereign:session:v1:<hex>` (`SESSION_PREFIX_V1`), but legacy unprefixed session ids
  are also present in the same table today, and comparing a `urn:sovereign:session:v1:…`
  id against a legacy unprefixed one by `id DESC` is a plain lexicographic string
  comparison, not a recency comparison — exactly why a reader cannot pick "the current
  session" by id shape alone. `latest_session_id_with_v1_preference` exists precisely
  *because* both shapes are live: it does not index by `id DESC` at all. As of 2026-08-06
  it also no longer re-derives its own order — its selection rule
  (`packages/agent/src/session/pure.rs::pick_latest_session_id`) scans the storage
  layer's already-newest-first result for the first v1-prefixed row, falling back to the
  first row of any shape. Before 2026-08-06 it instead ran its own
  `max_by_key(created_at_ns)` scan over that same result — the second, disagreeing sort
  order "What a caller must do" above forbids; see the affected-reader table for the
  fix.

  So the guarantee is narrower than "every id minted this way": a reader may index a
  `query_nodes*` result positionally only where every id sharing a same-second tie was
  minted through `new_id()` under the SAME prefix — no `MODEL_AGENT_ID` variance, no mixture
  of a current and a legacy id scheme for that type.

- **Random.** `packages/tractor/src/streaming/observations.rs:26` and
  `packages/tractor/src/host/wasi_bridge/model_stream_events.rs:635` both mint ids as
  `format!("urn:...:{}", uuid::Uuid::new_v4())`. A same-second tie between two such rows
  sorts by raw UUID comparison — a coin flip, uncorrelated with which one was actually
  written first.

This is exactly why
`host::wasi_bridge::tests::store_stream_agent_response_chunks_from_sse_persists_partial_nodes`
(`packages/tractor/src/host/wasi_bridge_tests/model_stream_events.rs`) began failing about
three runs in five once the ordering fix landed, while no other positional `nodes[0]` site
in the test suite did. That test wrote two `Response`/`StreamChunk` rows (random-UUID ids,
`stream_agent_response_chunk_id` / `stream_chunk_observation_id`) in the same second and
indexed the `query_nodes` result positionally (`payloads[0]`, `payloads[1]`), asserting
insertion order. Reproduced directly: 3 failures in 5 runs against the unmodified ordering
fix (via `git stash`), 0 failures in 20 consecutive runs after the test was changed to sort
by the chunk's own `sequence` field before indexing — the fact the test actually meant to
assert, not the storage layer's read order (commit `ac021184`).

The general rule this proves, stated once so it does not need re-deriving per call site:
**a reader that indexes a `query_nodes*` result positionally is safe only where the ids
involved are minted monotonically.** Where they are random (any `Uuid::new_v4()` id
family), a same-second tie is genuinely unordered from the caller's point of view, and
the *only* thing keeping two rows apart in that case is the ordering guarantee's tiebreak
picking *some* consistent order — not necessarily the one a human would call "recent."

A caller that needs to know which of several rows is semantically newest despite a
same-second tie must key on a field it controls the meaning of (a `sequence` number, a
nanosecond-precision timestamp embedded in the payload) — not on `query_nodes`'s row
order, which is real and total, but coarser than nanosecond and only as meaningful as the
id scheme backing it.

## A failure shape that showed up three times in one session

Worth naming on its own, because recognising the shape is worth more than any one fix.
Three defects, fixed by three different authors in this repository within the same working
session, share one structure:

1. `refarm context` printed `"No divergences"` when run from outside the monorepo — an
   unresolvable built-artifact path fell through a truthy guard that treated "could not
   check" the same as "checked, and it's fine."
2. The runtime freshness check fell back to a reconstructed path when the real one
   couldn't be resolved, and reported `fresh` about a file nothing actually loads.
3. `budget.ts` (before Task 2's fix, see above) would have invented `truncated: false`
   when the sidecar's response omitted the field — asserting completeness in exactly the
   case where completeness was unknown.

In every case, **only two states existed where three were needed** — success/failure,
fresh/stale, complete/truncated — and "I do not know" had nowhere to go, so it collapsed
into whichever of the two states read as "fine." The antidote that worked all three times
was **structural, not disciplinary**: make the third state a value the type system forces
a caller to handle (an explicit `undefined`/`unknown` variant threaded through with no
default-filling), rather than a boolean or a null that silently reads as falsy. Reviewing
harder does not fix this class of bug reliably — the code reads correctly at every single
site, right up until the moment "unknown" needs to be told apart from "no."

## What the fix cost, deliberately not disguised

`query_nodes` still returns `Vec<NodeRow>` — a caller cloning the whole type into memory
before discarding most of it is unchanged where it wasn't rewritten. At the time this
fix landed, that was true of 7 of the 9 affected callers in the table above — every one
in `packages/agent/src` and `packages/delegate/src` — left untouched (see "Known
follow-up" below, as it read then). The fix was the ordering and the two new entry
points, not a rewrite of every reader.

**Updated 2026-08-06, follow-on plan:** the WASM bridge's `query-nodes` host call
stopped materialising whole tables too (commit `8bf5d345`) — see the affected-reader
table above and the paragraph beneath it for how, and for why the 4 callers that still
read "No" there were never wrong to begin with.

## Verification — what actually ran, and what only got read

The record needs to say this precisely, because a broader claim than the method behind it
is how the next person stops checking.

**Executed**, against the fix (`packages/tractor`, cwd set explicitly — this crate has no
root Cargo workspace):

- The `packages/tractor/src` module test suites: `storage` (16 tests), `sidecar` (480
  tests), `node::` (26 tests), plus the two new/targeted tests (`count_nodes`,
  `sidecar_query_nodes_reports*`) — all green.
- Three integration binaries under `packages/tractor/tests/`, each runnable without a
  WASM component build: `conformance` (10 tests — loads the git-tracked
  `tests/fixtures/null-plugin.wasm` fixture), `host_integration` (12 tests — same
  fixture), `sync_crdt` (8 tests — needs no WASM at all). All green.
- The regression the ordering fix surfaced
  (`store_stream_agent_response_chunks_from_sse_persists_partial_nodes`, see above): 5
  consecutive runs against the unfixed test (3 failed, 2 passed — a genuine ~50% flake,
  not noise), then 20 consecutive green runs after the test was corrected to sort by
  `sequence`.

**Read, not executed**: `agent_harness.rs`, `vault_plugin_harness.rs`,
`delegate_plugin_harness.rs`, `identity_provider_harness.rs`. Each of these harnesses
loads a compiled `.wasm` component (`agent.wasm`, `vault_plugin.wasm`,
`quality_plugin.wasm`, `delegate`'s `dist/plugin.wasm`, `identity_provider.wasm`), and
CLAUDE.md §7's build discipline is explicit that `cargo component build --release` is for
when "agent/WIT changed and a harness test must execute" — neither was true for this fix,
which touched neither WIT nor any WASM guest source. Each file's `query_nodes` call sites
were read by hand instead: `delegate_plugin_harness.rs` and `identity_provider_harness.rs`
key their multi-row results by `replyRef` content, never by position;
`vault_plugin_harness.rs`'s two positional `results[0]` sites each follow exactly one
dispatch call in a freshly-created store (structurally one row); `agent_harness.rs`'s
positional sites either follow a `rows.len() == 1` guard, query a session node upserted
onto one stable id, or — where genuinely multi-row (`agent_harness.rs:722-759`, the
streaming test's `Response` and `StreamChunk` rows) — are safe for a reason that has
nothing to do with the id scheme: those two node types are minted with the RANDOM-UUID
scheme (`streaming/observations.rs`, `model_stream_events.rs`), the very family that caused
the regression this document names below, and the test does not lean on `id DESC` for them
at all. It sorts both result sets by the payload's own `sequence` field
(`agent_harness.rs:728` and `:747`) before indexing positionally, so a same-second tie in
the underlying id order cannot reach the assertions.

**One correction to the record, so it is not repeated**: an earlier draft of this sweep
claimed all four of those harnesses lacked their WASM artifact in this environment. That
is **false** for `identity_provider_harness`:
`packages/identity-provider-ref/dist/identity_provider.wasm` exists on disk at exactly the
path that harness checks for. The harness was runnable and was simply not run — a method
gap, not a missing-build gap. The conclusion about its code (keyed on `replyRef`, not
position) still holds on independent reading; the reason given for not running it does
not.

## Known follow-up, out of scope here — one item resolved, one still open

`latest_session_id_with_v1_preference(20)` and `latest_session_leaf_id(10)`
(`packages/agent/src/session/wasm_ops.rs`) were expected here, when this predecessor
fix landed, to become correct as a mere **consequence** of it — "taking the first N of
a now-newest-first result is now the newest N" — with no code change of their own and
no rebuild required beyond the next ordinary one. That expectation was wrong in one
detail: neither function simply took the first N. Both re-derived "newest" with their
own `max_by_key(created_at_ns)` scan on top of the storage layer's order, which is a
second, disagreeing sort order and would have kept producing wrong answers regardless
of how correctly `query_nodes` was ordered upstream. Fixed 2026-08-06, in a follow-on
plan (`.superpowers/sdd/2026-08-06-the-contract-reaches-every-consumer/`, commits
`54642ffb` and `1ca1f08f`) — see the affected-reader table above for how, and that
plan's Task 4 for the harness run (`agent_harness session`, 3/3 pass) and node proof
(`refarm sessions list --json` resolving an active session among 9) that exercised the
guest-side call this document could not natively test.

**The two session helpers do not mirror each other, and that was checked rather than
assumed.** `latest_session_id_with_v1_preference` prefers a
`urn:sovereign:session:v1:`-prefixed id over a legacy unprefixed one when both are
present in the result — its rule is "the first v1-prefixed row in the storage layer's
order, else the first row of any shape." `latest_session_leaf_id` reads a
`leaf_entry_id` field off whichever row is first in that same order and never compares
id shapes at all — no v1 branch belongs in it, because it is not choosing between two
id-shape candidates, it is skipping a leading row that has no leaf yet (a freshly
created session with no entries). This was confirmed by reading what each function
actually returns — a session id vs. a field value — before applying the fix, rather
than reflexively mirroring the sibling's v1-preference branch into the leaf lookup;
doing so would have been a wrong consistency fix, changing correct behaviour to match
an unrelated sibling's shape.

`currentRateTableFrom` (`apps/refarm/src/commands/budget.ts`) was deliberately left
untouched by both plans. It takes the maximum timestamp across whatever nodes it is
handed and is correct given that input — the defect was entirely upstream of it (the input
used to be the oldest N, not "the oldest," so its output used to be "the newest of the
oldest N" — a correct function fed a wrong slice, not a wrong function).

## The guest gets a truncation signal — closing the gap this document used to defer

Fixed 2026-08-06, in a third plan (`.superpowers/sdd/2026-08-06-the-guest-can-tell/`),
the same day as the follow-on plan above. "The guest has no truncation signal" — listed
in "What is still deferred" below as one of three remaining gaps until this plan landed
— is closed.

**How.** `packages/plugin-wit/wit/host.wit`'s `query-nodes` (line 32) changed in place,
in the versioned package `plugin:host@0.1.0`, from `func(node-type: string, limit: u32)
-> result<list<json-ld-node>, plugin-error>` to `-> result<node-page, plugin-error>`,
where `node-page` is a new record — `nodes: list<json-ld-node>`, `stored: u32`,
`truncated: bool` — with `truncated` derived the same way the sidecar handler derives it
(`stored > nodes.len()`, never from `limit`; commit `89332598`). This is a **breaking**
change to an already-published WIT interface, chosen over adding a second, longer-named
function that returned the new shape: the plan's own blast-radius check found every
plugin installed on the operator's node has in-repo source (`git ls-files` returns
nothing for any crate's generated `bindings.rs`, confirming no compiled artifact depends
on the old shape) and no third-party compiled plugin exists against `plugin:host@0.1.0`
today — so a second function would have left a shorter-named, blind alternative alive
for no consumer that needed it. `TractorBridgeHost::query_nodes`
(`packages/tractor/src/host/wasi_bridge/core.rs:387-406`) now calls both
`query_nodes_limited` (the rows) and `count_nodes` (the total) and constructs the
`node-page`, mirroring `sidecar/mod.rs`'s `get_nodes` handler exactly instead of
re-deriving the rule.

Nine `query-nodes` call expressions, across seven functions in
`packages/agent/src` and one in `packages/delegate/src` (`query_history` makes two,
one for `UserPrompt` and one for `Response`), broke on the signature change and were
repaired mechanically — `.nodes` off the new record, no reordering, no new logic,
`truncated` read nowhere in this pass (commit `639c9558`). One of the nine —
`budget_exceeded_for_provider` — is the site Task 3 went on to rewrite for behaviour,
covered on its own below; the other eight are still `.nodes`-only today, listed in the
table below. Four crates that import `tractor-bridge` but never call `query-nodes` —
`lsp-code-ops`, `pi-agent`, `scarecrow-plugin`, `identity-provider-ref` — regenerated
against the new contract for free, with no code change, because their `bindings.rs` is
gitignored and rebuilt from the WIT on every compile.

### The budget guard — the concrete harm the missing signal was causing

`packages/agent/src/session/wasm_ops.rs`'s `budget_exceeded_for_provider` sums 30 days
of `UsageRecord` spend against `MODEL_BUDGET_<PROVIDER>_USD` and decides whether a
completion is allowed to proceed. Before this plan, it called
`query_nodes("UsageRecord", 10_000).unwrap_or_default()` and summed whatever came back:
a truncated read summed a partial set with no signal it was partial, and
`.unwrap_or_default()` turned a host query error into an empty list — both resolving to
"spend is whatever I could see," which for a truncated or failed read reads as **under
budget** in a guard whose whole job is to block spend. Before the predecessor plan fixed
`query_nodes`'s ordering, this was worse still: the un-ordered read handed back the
**oldest** 10,000 rows, which against a rolling 30-day window are mostly outside it, so
the guard was effectively disabled by an ordering bug nobody had connected to budget
until this plan traced it.

The fix is not "read `truncated` and refuse to decide" — the controller's ruling
(`progress.md`) was FAIL OPEN BUT LOUD when the total genuinely cannot be established,
but three sessions of review found that the *previous* design was offering the guard
fewer options than it actually had. `resolve_budget_check`
(`packages/agent/src/session/pure.rs:183-226`) rests on one idea, applied twice: **a
bound provable without complete data is not uncertainty.**

1. **A budget of zero or less blocks before any query runs at all.** Every real
   `estimated_usd` is non-negative, so `0.0 >= budget_usd` holds unconditionally when
   `budget_usd <= 0.0` — provable with no `UsageRecord` read. `resolve_budget_check`
   checks this first (`pure.rs:195-199`) and the closures for both the first query and
   the re-query are never invoked; a unit test (`budget_zero_or_negative_blocks_without_any_query`)
   pins this by passing panicking stubs in their place.
2. **A partial sum that already meets the budget blocks, without waiting for the rest.**
   Every row's `estimated_usd` is non-negative, so a subset's sum is a valid lower bound
   on the true total — if that lower bound already meets or exceeds `budget_usd`, no
   further data can change the answer, and the check is `Known`, not `Unknown`, even
   though `truncated` is `true` (`pure.rs:212-216`).
3. **Truncated and still under budget re-queries with `limit = stored`.** Only when the
   visible sum is under budget does the missing data actually matter; `stored` — the
   `node-page`'s own true row count, independent of `limit` — becomes the new query's
   limit, and the guard decides on that complete set (`pure.rs:219-225`).

Only a genuine query error — the first read or the follow-up read returning `Err`
— remains `Unknown`, and only then does `wasm_ops::budget_exceeded_for_provider` emit
`agent:budget:unknown` (naming the reason) before collapsing it to "proceed"
(`agent_events.rs`'s `EVENT_BUDGET_UNKNOWN`, mirrored into `activity.ndjson` via
`agent_event_to_activity` in `packages/tractor/src/sidecar/agent_activity.rs`, so the
"loud" half is actually visible on the surface the CLI tails, not just emitted into the
void). `BudgetUnknownReason`'s `Truncated` variant — live in round 1 (`5a9bd759`,
`65e38f10`) — was deleted in round 2 rather than left unreachable, once truncation
stopped being a reason to be unknown at all — the doc comment on the enum states
directly that "a variant that can never be constructed is worse than no variant: it
looks live and isn't."

This went through three implementation rounds inside the same plan, each caught by
review, not shipped and left wrong: round 1 (`5a9bd759`) modelled `Unknown` but mapped
both truncation and query error to it unconditionally, and its own doc comment falsely
claimed this was behaviour-preserving — it was a real loosening, dropping a block a
truncated-but-over-budget page used to produce. Round 1's correction (`65e38f10`) fixed
the false claim and mirrored the telemetry into `activity.ndjson`, but left the
truncated case genuinely unknown rather than resolving it. Round 2 (`576cfc02`) is the
arithmetic resolution described above for truncation. Round 3 (`d77a614c`) closed the
one path round 2 had still left open: a query error under `MODEL_BUDGET_<PROVIDER>_USD=0`
used to block by *accident* (`0.0 >= 0.0`, unconditionally true regardless of query
success), and round 2's `Unknown` → proceed mapping had silently dropped that hard stop.
Case 0 above restores it deliberately.

**Verified case by case against the pre-plan baseline** (documented in
`budget_exceeded`'s doc comment, `pure.rs:236-263`): every block the operator previously
had is still produced — the `budget_usd <= 0.0` hard stop, and a truncated-but-over-budget
page — and one block he never had is gained: a total that is over budget but whose
visible page (under the old 10,000-row cap) was under. No path decreases blocking
relative to the pre-plan baseline.

**Cost, stated rather than hidden.** The re-query in case 3 above is unbounded and lands
on a hot path. `query-nodes` filters by node **type**, not by provider, so
`truncated`/`stored` are driven by system-wide `UsageRecord` volume across every
provider, not the one provider being checked. `packages/tractor/src/node_reap.rs`'s
`REAPABLE_TYPES` (line 35) lists only the agent-response node type, `StreamChunk`, and
`StreamSession` — `UsageRecord` is not in it and is never pruned. Once total stored
`UsageRecord` rows cross the query's row ceiling for any provider, the truncated branch
stops being an edge case: it fires on every call this guard makes from then on, and
`budget_exceeded_for_provider` runs on every primary **and** fallback completion
(`runtime/wasm_flow.rs`). Past that point the full re-query becomes a permanent per-call
cost, growing roughly linearly with total stored records. Two ways out, neither chosen
here: sum on the host side instead of fetching every row into the guest, or make the
query filterable by provider so truncation tracks one provider's history instead of the
system's.

**A NaN budget silently disables the guard, with no telemetry — pre-existing, not
introduced or fixed here.** `"nan".parse::<f64>()` succeeds in Rust and produces
`f64::NAN`. `NaN <= 0.0` is `false`, so case 0's zero-or-negative short-circuit does not
fire, and every subsequent `>=` comparison against `NaN` is also `false`, so the guard
never blocks. Because this lands in `Known` (case 0 was simply never reached) rather
than `Unknown`, no `agent:budget:unknown` telemetry fires either — a
`MODEL_BUDGET_<PROVIDER>_USD=nan` misconfiguration is indistinguishable from a provider
legitimately under budget, on the record or in the logs. This behaviour is identical
before and after this plan; it is recorded here because it sits one line away from the
fix and deserves its own follow-up (rejecting non-finite budgets at parse time), not
because this plan changed it.

**Eight call sites still discard `truncated`** — every guest call site this plan
touched except the budget guard itself:

| Call site | File | Query |
| --- | --- | --- |
| `latest_session_id_with_v1_preference` | `packages/agent/src/session/wasm_ops.rs:~46-50` | `Session` |
| `latest_session_leaf_id` | `packages/agent/src/session/wasm_ops.rs:~88-92` | `Session` |
| `query_history` (`UserPrompt` branch) | `packages/agent/src/session/wasm_ops.rs:~248` | `UserPrompt` |
| `query_history` (`Response` branch) | `packages/agent/src/session/wasm_ops.rs:~249-253` | `Response` |
| `task_context_for_prompt` | `packages/agent/src/runtime/policy.rs:128` | `Task` |
| `list_tasks` | `packages/agent/src/tool_dispatch/task_tools.rs:8` | `Task` |
| `task_status` (`TaskEvent` lookup) | `packages/agent/src/tool_dispatch/task_tools.rs:44-46` | `TaskEvent` |
| `load_personas` | `packages/delegate/src/lib.rs:230` | persona nodes |

None of these is a correctness bug the way the budget guard was — each caller already
took the front `N` rows of an already-ordered result and used them, same as before the
contract change — but each can now no longer tell a complete answer from a cut one
either, because none of them looks at the field that would tell it. That is what this
plan left on the table; the next reader should not assume the propagation of
`truncated`, as opposed to `.nodes`, was total.

**Proven live, on node `sede`.** The agent component was rebuilt
(`pnpm --filter @refarm.dev/agent run build`), installed, and the runtime restarted;
loaded and built plugin hashes moved together from `cff89975` to `50483c6c`. Filtered
harness session tests: `cargo test --test agent_harness session -- --ignored
--test-threads=1` → 3/3 pass — a guest built against a stale `query-nodes` shape would
fail here, and did not. `refarm sessions list --json` resolved the active session.
`refarm budget observations --limit 1 --json` — the same predecessor-plan proof point —
stayed unregressed: newest observation `2026-08-05T17:29:36`, `stored: 29, truncated:
true`.

## What is still deferred, named rather than left silent

Two gaps remain — the guest-truncation-signal gap named here in earlier drafts of this
document is closed (see "The guest gets a truncation signal" above). Neither remaining
gap is a regression — each is a boundary no plan to date has crossed, named here so the
next reader does not have to rediscover it.

- **There is no paging past `MAX_NODES_PER_RESPONSE`.** The ceiling (100,
  `packages/tractor/src/sidecar/mod.rs:1521`) is now honestly reported —
  `truncated: true` says rows were left out — but honesty is not access. A caller
  that needs row 101 of a type has no `--limit`, no cursor, no offset that reaches
  it; the response can only say truthfully that more exists, not hand it over.
- **The graph client throws against the real daemon.** `SidecarGraphClient.queryNodes`
  and `.getNode` (`packages/sidecar-client/src/index.ts`) reject any node lacking
  `@context`, and the Rust sidecar's `GET /nodes` does not set `@context` on any node
  type today — a pre-existing condition, already noted in
  `apps/refarm/src/commands/budget.ts`'s own doc comment, not introduced or fixed by
  either plan. It means the client this plan improved is not yet usable against a
  live node.

## Where this lives

| Concern | File |
| --- | --- |
| The ordering guarantee (`query_nodes` / `query_nodes_limited` / `count_nodes`) | `packages/tractor/src/storage/sqlite.rs` |
| The HTTP reader, its ceiling, `stored`/`truncated` | `packages/tractor/src/sidecar/mod.rs` (`get_nodes`, `MAX_NODES_PER_RESPONSE`) |
| The WASM bridge's `query-nodes` host call, fixed 2026-08-06 to apply `LIMIT` in SQL | `packages/tractor/src/host/wasi_bridge/core.rs` (`TractorBridgeHost::query_nodes`), passthrough in `packages/tractor/src/sync/loro.rs` (`NativeSync::query_nodes_limited`) |
| The agent's session helpers, fixed 2026-08-06 to stop re-sorting | `packages/agent/src/session/wasm_ops.rs` (call sites), `packages/agent/src/session/pure.rs` (`pick_latest_session_id`, `pick_latest_session_leaf_id` — the tested decision logic) |
| The TS graph client's `stored`/`truncated` propagation, fixed 2026-08-06 | `packages/sidecar-client/src/index.ts` (`QueryGraphNodesResult`), `apps/refarm/src/utils/tractor-store.ts` (`tractorGraphFromNodeView`) |
| The guest-side contract, fixed 2026-08-06 to carry `stored`/`truncated` (breaking change to `plugin:host@0.1.0`) | `packages/plugin-wit/wit/host.wit` (`query-nodes`, `node-page`) |
| The budget guard, fixed 2026-08-06 to resolve truncation and query error into a real third state instead of discarding them | `packages/agent/src/session/wasm_ops.rs` (`budget_exceeded_for_provider`), `packages/agent/src/session/pure.rs` (`resolve_budget_check`, `budget_exceeded`, `BudgetCheck`, `BudgetUnknownReason`) |
| The 8 guest call sites still discarding `truncated` after the contract change | see the table in "The guest gets a truncation signal" above |
| The CLI command that made the original defect visible | `apps/refarm/src/commands/budget.ts` (`refarm budget observations`) |
| The monotonic id scheme | `packages/agent/src/utils.rs:516-523` (`new_id`) |
| The two random id schemes | `packages/tractor/src/streaming/observations.rs:26`, `packages/tractor/src/host/wasi_bridge/model_stream_events.rs:635` |
| The read path, drawn — updated 2026-08-06 for the guest-contract change; the WASM bridge box shows it returning `node-page`: `nodes` + `stored` + `truncated` | [`specs/diagrams/record-read-path.mermaid`](../specs/diagrams/record-read-path.svg) |
| The plan and its task-by-task record (storage-layer ordering fix) | `.superpowers/sdd/2026-08-06-the-record-reader-goes-blind/` |
| The follow-on plan and its task-by-task record (bridge cost, session correctness, TS client) | `.superpowers/sdd/2026-08-06-the-contract-reaches-every-consumer/` |
| The third plan and its task-by-task record (guest contract, budget guard) | `.superpowers/sdd/2026-08-06-the-guest-can-tell/` |

> _Active Inference framing:_ an unordered read is not wrong the way a bad computation is
> wrong — it is a query that never asked reality a precise enough question to reduce
> uncertainty. Every caller was already acting on "the first N rows" as if that sampled
> the most recent state; the fix does not add new behavior, it makes the query match the
> question every caller was already asking.
