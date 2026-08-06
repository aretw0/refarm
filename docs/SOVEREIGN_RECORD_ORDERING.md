# The sovereign record's read order — an invariant that cost more to find than to fix

> Fixed 2026-08-06 in `packages/tractor/src/storage/sqlite.rs` (`query_nodes` /
> `query_nodes_limited` / `count_nodes`). Plan:
> `.superpowers/sdd/2026-08-06-the-record-reader-goes-blind/`. Diagram:
> [`specs/diagrams/record-read-path.mermaid`](../specs/diagrams/record-read-path.svg).

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
`packages/agent/src` and `packages/delegate/src` and were missing from the first count:

| Caller | File | What it meant to read |
| --- | --- | --- |
| `GET /nodes?type=…` (→ `refarm budget observations`) | `packages/tractor/src/sidecar/mod.rs` | the newest page of a type |
| The WASM bridge's `query-nodes` host call | `packages/tractor/src/host/wasi_bridge/core.rs` | the newest N a plugin asked for |
| `latest_session_id_with_v1_preference` | `packages/agent/src/session/wasm_ops.rs:17-50` | the current session |
| `latest_session_leaf_id` | `packages/agent/src/session/wasm_ops.rs:64-76` | the session's most recent leaf entry |
| (transitively) conversation history fallback | `packages/agent/src/session/wasm_ops.rs:210-231` | recent turns |
| `list_tasks` | `packages/agent/src/tool_dispatch/task_tools.rs:8` | the newest N tasks |
| `task_status`'s `TaskEvent` lookup | `packages/agent/src/tool_dispatch/task_tools.rs:44` | this task's recent events |
| `task_context_for_prompt` | `packages/agent/src/runtime/policy.rs:128` | the newest N tasks for prompt context |
| `load_personas` | `packages/delegate/src/lib.rs:230` | the available personas |

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
- **Never re-sort in the caller.** The ordering guarantee is established once, in
  `query_nodes_inner`. A caller that re-derives "newest" by its own comparison (a second
  `max_by_key` on a timestamp field, a second sort by a different key) creates a **second
  sort order** next to the first one. Two sort orders over the same data are exactly how
  two answers drift apart — the moment their tiebreak rules diverge (as `updated_at`
  second-resolution and a raw `created_at_ns` field already can), the two paths can
  legitimately disagree about which row is "the latest," and nothing will flag it because
  both answers are locally correct by their own rule. One ordering, established in one
  place, is what keeps that from happening.
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
  are also present in the same table today — `latest_session_id_with_v1_preference`
  (`wasm_ops.rs:17-50`) exists precisely *because* both shapes are live, and it falls back to
  its own `max_by_key(created_at_ns)` scan rather than trust `id DESC`, since comparing a
  `urn:sovereign:session:v1:…` id against a legacy unprefixed one is a plain lexicographic
  string comparison, not a recency comparison.

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
before discarding most of it is unchanged where it wasn't rewritten (7 of the 9 affected
callers in the table above — every one in `packages/agent/src` and `packages/delegate/src` —
were left untouched; see "Known follow-up" below). The fix is the ordering and the two new
entry points, not a rewrite of every reader.

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

## Known follow-up, out of scope here

`latest_session_id_with_v1_preference(20)` and `latest_session_leaf_id(10)`
(`packages/agent/src/session/wasm_ops.rs`) become correct as a **consequence** of this
fix, since taking the first N of a now-newest-first result is now the newest N — they were
not modified, and no task in this plan rebuilds the `agent` WASM component. The ordering
fix lives entirely in the host (`packages/tractor`); the guest-side callers inherit it for
free the next time `agent.wasm` is rebuilt against a host running the fixed query.

`currentRateTableFrom` (`apps/refarm/src/commands/budget.ts`) was deliberately left
untouched by this whole plan. It takes the maximum timestamp across whatever nodes it is
handed and is correct given that input — the defect was entirely upstream of it (the input
used to be the oldest N, not "the oldest," so its output used to be "the newest of the
oldest N" — a correct function fed a wrong slice, not a wrong function).

## Where this lives

| Concern | File |
| --- | --- |
| The ordering guarantee (`query_nodes` / `query_nodes_limited` / `count_nodes`) | `packages/tractor/src/storage/sqlite.rs` |
| The HTTP reader, its ceiling, `stored`/`truncated` | `packages/tractor/src/sidecar/mod.rs` (`get_nodes`, `MAX_NODES_PER_RESPONSE`) |
| The WASM bridge's `query-nodes` host call | `packages/tractor/src/host/wasi_bridge/core.rs` (`TractorBridgeHost::query_nodes`) |
| The agent's session helpers that ride on the guarantee without modification | `packages/agent/src/session/wasm_ops.rs` |
| The CLI command that made the defect visible | `apps/refarm/src/commands/budget.ts` (`refarm budget observations`) |
| The monotonic id scheme | `packages/agent/src/utils.rs:516-523` (`new_id`) |
| The two random id schemes | `packages/tractor/src/streaming/observations.rs:26`, `packages/tractor/src/host/wasi_bridge/model_stream_events.rs:635` |
| The read path, drawn | [`specs/diagrams/record-read-path.mermaid`](../specs/diagrams/record-read-path.svg) |
| The plan and its task-by-task record | `.superpowers/sdd/2026-08-06-the-record-reader-goes-blind/` |

> _Active Inference framing:_ an unordered read is not wrong the way a bad computation is
> wrong — it is a query that never asked reality a precise enough question to reduce
> uncertainty. Every caller was already acting on "the first N rows" as if that sampled
> the most recent state; the fix does not add new behavior, it makes the query match the
> question every caller was already asking.
