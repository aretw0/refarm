# A page says it is a page

**Date:** 2026-08-11
**Family:** ISS-040 (root), ISS-041, ISS-042, ISS-047 — and it unblocks ISS-039.
**Serves:** the three-states discipline, applied to reads: *nothing found* ≠ *did not look* ≠ *looked past the edge*.

## Measure first: half of this family is already done

Every claim in the four items was re-measured on 2026-08-11 against the code, not
the tickets. Two are stale, one is confirmed and **worse than filed**, one is
half-true.

| Item | Filed claim | Measured 2026-08-11 |
| --- | --- | --- |
| **ISS-047** | "the WASM bridge still does `query_nodes + .take(limit)`, and its WIT returns a bare `list<string>`" | **STALE, both halves.** `wasi_bridge/core.rs` calls `query_nodes_limited` (the limit is applied in SQL), returns `NodePage`, and `host.wit:24` declares `record node-page { nodes, stored, truncated }`. Fixed 2026-08-06 — the same day the item was filed, against the pre-fix state, and never re-read. |
| **ISS-042** | "no paging past `MAX_NODES_PER_RESPONSE`; rows beyond 100 unreachable at any limit" | **TRUE.** `NodesQuery` has `type` and `limit` and nothing else — no offset, no cursor. `limit.min(100)` is a hard ceiling on the only axis there is. |
| **ISS-041** | "`GET /tasks` holds an unlimited query, a second sort order and a silent truncate" | **TRUE, and worse.** All three confirmed at `sidecar/mod.rs:1732/1760/1766`. The fourth is unfiled: the response is `{ tasks, total: tasks.len() }` **computed after the truncate**, so `total` is always the page size. A consumer reading `total` to ask "is there more" is answered "no", always. |
| **ISS-040** | "the contract `queryNodes(type): Promise<unknown[]>` has nowhere to put truncation" | **TRUE, and it is the root.** |

**So this is not a fix-everything slice.** ISS-047 closes by re-measurement. The
real work is one contract change and two endpoints.

## The shape of the defect

The Rust host learned this lesson on 2026-08-06 and the TypeScript contract did
not. Today:

```
WIT               node-page { nodes, stored, truncated }     knows
sidecar HTTP      { nodes, stored, truncated }               knows        (GET /nodes)
sidecar-client    { nodes, stored?, truncated? }             knows, three-state
StorageAdapter    queryNodes(type): Promise<unknown[]>       CANNOT KNOW  <- the root
GET /tasks        { tasks, total: <page size> }              says the wrong thing
```

Nineteen consumer files discard truncation. ISS-040's own re-measurement is the
important sentence: **they discard it because the contract has nowhere to put
it.** That is a structural fact, not carelessness, and no consumer-by-consumer
fix reaches it.

## The design

### 1. `queryNodes` keeps its signature. A sibling carries the page.

```ts
interface StorageAdapter {
  queryNodes(type: string): Promise<unknown[]>;              // unchanged
  queryNodesPage?(type: string, options?: QueryNodesOptions) // NEW, optional
    : Promise<QueryNodesPage>;
}
```

**Why a sibling and not a widened return.** 15 files implement this interface and
19 consume it, across 56 call sites. Changing the return type is a single commit
that touches all of them, and this repo has spent a day proving that a wide
change lands its own defects — the blanket rename two slices ago rewrote three
schemas when it should have rewritten two, and the assertion it broke is the only
reason anyone noticed.

**Why OPTIONAL is not a hedge.** `queryNodesPage === undefined` is a real,
readable answer: *this adapter cannot tell you whether the read was complete.*
That is exactly the third state the family is about, expressed in the type
system, and it is how a consumer decides between "there are none" and "I could
not tell". A required method would force 15 implementations to invent
`truncated: false` — the one value that must never be guessed.

The repo already has this idiom: `Effort.workspace_source` rode beside
`workspace_id` rather than replacing it, and `resolveProjectHandoff` returned a
four-state resolution beside the block it describes.

### 2. The page type, with `absent` meaning absent

```ts
interface QueryNodesPage {
  nodes: unknown[];
  /** Total of this type, independent of any limit. ABSENT when the adapter cannot count. */
  stored?: number;
  /** ABSENT when the adapter cannot tell. Never defaulted to false. */
  truncated?: boolean;
}
```

Both optional, both for the same reason `sidecar-client` already documents: a
`stored` derived from `nodes.length` and a `truncated` defaulted to `false` are
guesses that read as measurements. `sidecar-client/src/index.ts:141-148` is the
reference implementation — it refuses both defaults and carries the rule in a
comment. This type is that rule, moved into the contract so it is not one
package's discipline.

### 3. One pure judgement, so 19 consumers stop each inventing their own

```ts
type ReadCompleteness = "complete" | "partial" | "unknown";
function readCompleteness(page: QueryNodesPage): ReadCompleteness;
```

- `complete` — `truncated === false`. The list is the whole answer.
- `partial` — `truncated === true`. There is more behind the edge.
- `unknown` — `truncated` absent. **An empty `nodes` here is not "there are
  none".**

This mirrors `describe_event_completeness` in `agent/src/session/pure.rs`, added
this same day for ISS-045 — where an empty list from a truncated read was being
reported to a *model* as a fact. One vocabulary, both stacks.

### 4. Paging, on the axis that exists (ISS-042)

`NodesQuery` grows `offset`, and `GET /nodes` answers `{ nodes, stored,
truncated, offset }`. Not a cursor: cursors need a stable sort key the store does
not yet guarantee across adapters, and `docs/SOVEREIGN_RECORD_ORDERING.md` is the
document that would have to change first. Offset is honest about what it is —
adequate for an operator paging a table, and it does not pretend to be stable
under concurrent writes. Say that in the field's doc.

`MAX_NODES_PER_RESPONSE` stays. An unbounded response is its own hazard; the fix
is reachability, not removal of the ceiling.

### 5. `GET /tasks` stops being the exception (ISS-041)

Four changes, and the fourth is the one nobody filed:

1. `storage.query_nodes("Task")` → `query_nodes_limited`, the same SQL-side limit
   `GET /nodes` already uses.
2. Drop the `created_at_ns` re-sort. The store's order is the answer — the same
   correction farmhand's `GET /sessions` took today (ISS-044), and the reason the
   guest sibling and this endpoint currently disagree about "the newest N".
3. Report `stored` and `truncated`, like `GET /nodes`.
4. **`total` must stop meaning the page size.** It is computed after
   `truncate(limit.min(100))`, so it always equals `tasks.len()`. Either it
   becomes the true stored count or it is removed — and removing it is safer,
   because a key whose meaning changes silently is worse than one that vanishes
   loudly.

Filtering by `status`/`session_id` happens after the limit, which is the same
global-limit-then-filter shape ISS-045 just fixed in the agent. Either the filter
moves into SQL, or the response says the filtered answer may be incomplete. **Do
not leave it silent.**

## What this does NOT do

- **No cursor.** See §4.
- **No migration of the 19 consumers.** They keep working. A consumer adopts
  `queryNodesPage` when it has a reason — and the first two have one: `budget.ts`
  (ISS-039, summing a possibly-truncated set of `UsageRecord`s) and
  `barn/src/index.ts` (the plugin ledger).
- **No removal of `queryNodes`.** The bare list is the right answer for a caller
  that genuinely wants everything of a small type.

## Order of work, and what each step costs

| # | Step | Surface | Protected? | State |
| --- | --- | --- | --- | --- |
| 1 | Close ISS-047 by re-measurement | ledger only | no | **done** 2026-08-11 |
| 2 | `QueryNodesPage`, `readCompleteness`, optional method + conformance | `packages/storage-contract-v1` | no | **done** 2026-08-11 |
| 3 | Adopt in `sidecar-client` (it already has the shape) | `packages/sidecar-client` | no | **done** 2026-08-11 |
| 4 | `budget.ts` reads completeness — closes the visible half of ISS-039 | `apps/refarm` | no | **done** 2026-08-11 |
| 5 | `GET /tasks`, four changes | `packages/tractor` | **§8** | **done** 2026-08-11, one change made differently — see below |
| 6 | `offset` on `GET /nodes` | `packages/tractor` | **§8** | **done** 2026-08-11 |

### What steps 2–4 actually cost, measured

Three packages, `after-edit` green, and **two things the design did not predict**:

- **`readCompleteness` takes `Pick<QueryNodesPage, "truncated">`, not the whole page.** The
  judgement only ever reads one field, and `apps/refarm`'s `BudgetObservationsPage` calls its rows
  `observations`. A parameter typed as the full page would have forced those callers to build a
  throwaway object with a fake `nodes` — manufacturing data to satisfy a type, in the one file
  whose entire subject is not manufacturing data.
- **`QueryGraphNodesOptions` became a `type` alias, not an empty `extends`.** The linter caught it
  and was making this spec's own argument back at it: an interface that adds nothing is a second
  declaration pretending to be a first.

The conformance ships with a third verdict, `unsupported`, for an adapter that does not implement
`queryNodesPage`. Reporting that as `pass` would have been this family's exact defect, rebuilt
inside the instrument that exists to find it.

Steps 1–4 are reachable without a protected surface and close ISS-047 and ISS-040
and move ISS-039. Steps 5–6 need the maintainer's nod, the same one
`declared_base()` got.

## Verification

- **Step 2** ships with a conformance case, not just a type: an adapter that
  implements `queryNodesPage` and reports `truncated: false` while `stored`
  exceeds `nodes.length` must FAIL it. That is the one lie the type cannot
  prevent.
- **Step 5** is proven by the disagreement it removes: `GET /tasks` and the
  guest's `list_tasks` must answer the same "newest N" for the same store. A test
  that asserts only one side is what let them drift.
- Every step states its before/after counts, and `total`'s removal is called out
  in the commit message rather than left for a consumer to discover.

## What steps 5–6 cost, and the one instruction here that was wrong

**§2 was not carried out as written, deliberately.** The plan said to drop the
`created_at_ns` re-sort and let the store's order be the answer. That does make
`GET /tasks` and `list_tasks` agree — and it silently changes what `refarm tasks`
MEANS, from "the newest tasks" to "the most recently touched tasks", and makes it
disagree with farmhand's own `/tasks` route, which sorts by `created_at_ns` in
TypeScript. Two surfaces agreeing on the wrong answer is not an improvement over
two answering different questions.

So the ordering moved INTO SQL instead of being dropped — which fixes the real
incoherence (a limit taken in one order and presented in another) without
changing the endpoint's meaning. The disagreement survives, is documented, and is
now **ISS-115**: neither surface says which question it answers, which is the
shape-versus-purpose distinction rather than a sort bug.

**The verification criterion §"Step 5" states is therefore NOT met, and saying so
is the point.** It asked for a test proving the two agree. They do not agree, on
purpose. What ships instead is a test that the limit and the presented order use
one key — which is what catches the naive fix a future editor reaches for first,
and which was proven to discriminate by temporarily removing the SQL ordering and
watching two tests go red.

**Two things the plan did not anticipate:**

- **The filters had to move into SQL with the limit, or not at all.** Moving only
  the limit would have been *worse* than leaving the endpoint alone: `?status=done`
  would answer out of the newest 100 rows of any status and could report zero while
  hundreds of done tasks existed — ISS-045's shape, rebuilt while fixing something
  else.
- **`count_nodes_matching` takes the page's whole spec, not a copy of its filters.**
  The first draft copied only the filters, and `order_by_json_field` also pulls in
  the `json_valid` guard — so the count agreed with the page whenever a filter was
  present and disagreed the moment one was not. `GET /tasks` with no `?status` and
  one malformed row would have reported `truncated: true` permanently, about a row
  it could never return. Caught by a test whose assertion was wrong for the same
  reason the code was.

**The remedy had to reach the operator or step 6 was invisible.** `refarm budget
observations|by-*|usage` and `refarm tasks` all take `--offset`, and their notices
name the command and number that reach the rest. That sentence had been wrong
twice in opposite directions — "raise --limit" (which could not work) and then
"not reachable today" (true when written, false the moment offset shipped) — so it
now names a runnable command, the only form of the claim that goes stale loudly.
