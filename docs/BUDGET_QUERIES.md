# Asking What Something Cost

`refarm budget` reads back the `BudgetObservation` record every terminal effort writes
(`docs/superpowers/specs/2026-08-03-budget-laboratory-design.md`, D2/D3/D6/D9). Until
2026-08-08 there was exactly one subcommand, `observations` — a flat list, no grouping, no
window. This document is the operational record for the three questions the operator can now
ask directly, alongside `docs/SANDBOX_NODE.md` (a second node) and `docs/NO_OS_RESOLUTION.md`
(a resolver ratchet) as the pattern: a command surface gets a durable doc once it is right,
not re-derived from the source every time someone needs it.

Built by `docs/superpowers/plans/2026-08-08-what-did-this-cost.md`, Tasks 1–2 (commits
`817bcd08`, `e42c9e73`, `fc53a9c3`, `ad216c7e`). **Every command and every number below was
re-run against the operator's live graph on 2026-08-08 while writing this document** — not
copied from an earlier session's output.

---

## The three questions

### 1. What did this workspace cost?

```bash
refarm budget by-workspace --json
```

Groups every `BudgetObservation` by `refarm.workspace.id`. Live, 2026-08-08, verbatim
(`refarm budget by-workspace`, human output):

```
  Budget by workspace  (29 observation(s))

  refarm                       obs:5     in:7200     out:25       usd:—   (non-billable:5)
  rcdc5                        obs:3     in:5423     out:15       usd:—   (non-billable:3)
  (unattributed)               obs:21    in:53786    out:550      usd:—   (non-billable:21)
```

`refarm budget by-host` and `by-spawner` are the same shape over `host.id` and
`refarm.budget.spawner`:

```
  Budget by host  (29 observation(s))

  sede [f17151b4]              obs:22    in:58419    out:554      usd:—   (non-billable:22)
  (unattributed)               obs:7     in:7990     out:36       usd:—   (non-billable:7)
```

```
  Budget by spawner  (29 observation(s))

  refarm-ask                   obs:22    in:59275    out:554      usd:—   (non-billable:22)
  capability-dispatch          obs:7     in:7134     out:36       usd:—   (non-billable:7)
  (unattributed)               obs:0     in:0        out:0        usd:—
```

Note the by-workspace and by-host token sums differ (e.g. `in:7200` for `refarm` vs.
`in:58419` for the `sede` host) — they are grouping the *same* 29 records on two different
keys, not two different datasets; a record's workspace and its host are independent axes and
a row total on one says nothing about the other.

### 2. What did this node cost?

Same command, `--by host`, i.e. `refarm budget by-host --json` above — one row per `host.id`,
labelled by that node's declared `host.name` when it has one. Never grouped on the raw
`host.name` string: two real machines can legitimately declare the same name, and merging them
would silently absorb one node's spend into another's report (`RepresentedNode`'s doc,
`apps/refarm/src/commands/budget.ts`).

### 3. What have I used this period?

```bash
refarm budget usage --period 30d --json     # default; see "what usage cannot answer" below
refarm budget usage --period month --json   # current UTC calendar month
refarm budget usage --period 2026-08 --json # a specific calendar month
```

Live, 2026-08-08, verbatim (`refarm budget usage`, human output):

```
  Budget usage — last 30 days  (--period 30d)

  in period        obs:29    in:66409    out:590
  out of period    obs:0     in:0        out:0
  no timestamp     obs:0     in:0        out:0
```

```
  Budget usage — last 1 day  (--period 1d)

  in period        obs:0     in:0        out:0
  out of period    obs:29    in:66409    out:590
  no timestamp     obs:0     in:0        out:0

  No observations fall inside last 1 day (--period 1d).
```

The empty 1-day window is the more useful proof: it shows the filter filters, rather than
returning the whole record regardless of what was asked.

---

## Why dollars render `—`, never `$0.00`

All 29 live records are `refarm.pricing_mode: "subscription"` (the operator's daily route,
`openai-codex`) and the honest dollar sum over every one of them is `0.0`. `$0.00` printed
next to real, completed work teaches the operator to ignore the column — and it would later be
indistinguishable from a *metered* route's genuine zero (a `pricing_mode: "api"` run that
really did cost nothing). So the group's `usd` field is `number | null`, and `null` renders as
`—`: the axis does not apply here, as opposed to applying and reading zero.

**The billable branch is POSITIVE, not exclusionary — this is the load-bearing decision.**
`packages/agent/src/utils.rs:12-18`'s `pricing_mode_for_provider` has **three** return values,
not two:

```rust
"openai-codex" | "github-copilot" => "subscription",
"ollama" => "local",
_ => "api",
```

The code that shipped in `817bcd08` originally tested only `pricing_mode === "subscription"`
and treated everything else as billable — which means an all-Ollama workspace (`"local"`,
first-class in this repo, genuinely free) would have reported `usd: 0` as if it had been priced
and confirmed cheap, rather than never priced at all. Code review (`fc53a9c3`) inverted the
branch: a member contributes to `usd` **only** when

```ts
node["refarm.pricing_mode"] === "api" && node["refarm.cost.price_known"] === true
```

Everything else — `"subscription"`, `"local"`, an absent `pricing_mode`, or a fourth mode this
file has never seen — lands on the safe, unbilled side *by construction*. A fifth pricing mode
added in Rust tomorrow does not require anyone to remember to update this file; the exclusion
is the default, not the enumeration.

## Why "nothing recorded" is not "nothing spent"

An effort that fails before any model call — a bad argument, a plugin not loaded, a budget
ceiling that blocks before dispatch — still writes a `BudgetObservation`, because
`write_budget_observation` (`packages/tractor/src/sidecar/dispatch.rs:877`) runs unconditionally
for every terminal effort (`done`/`delivered`/`partial`/`failed`/`timed-out`/`cancelled`).
But `find_usage_record_for` (`packages/tractor/src/sidecar/dispatch.rs:1037-1049`, `None`
returned at line 1048 when no `UsageRecord` node matches the effort's `prompt_ref` — which is
exactly what happens when none was ever written) returns `None` for that effort, and `put_usage`
(`packages/tractor/src/sidecar/observation.rs:142-146`) returns immediately on `None` — before
setting `refarm.pricing_mode`, `refarm.cost.price_known`, `refarm.cost.estimated_usd`, or a
single `gen_ai.usage.*` token field.

So this record carries **no `pricing_mode` at all** — not `"subscription"` reading zero, not
`"api"` reading unpriced, nothing. Both surfaces name this explicitly rather than letting it
fall through as a silent zero:

- `groupObservations`' `GroupTotals.noUsageRecord` — a group-level count.
- `usageByPeriod`'s `PeriodBucket.noUsageRecord` — per in-period/out-of-period/no-timestamp
  bucket, so a period of five failed efforts reports `output: 0` **and** `no-usage-record: 5`,
  never `output: 0` alone (indistinguishable, without the flag, from five efforts that ran and
  genuinely produced nothing).

Distinct from `priceUnknown` (a real `UsageRecord` exists, tokens are real, only the dollar
figure could not be established) and from `structuralZeroMembers` (the cost IS zero, on
purpose — `"subscription"`/`"local"`). Three different gaps, three different names, on purpose.

## What `refarm budget usage` cannot answer

Printed unconditionally on every response, human and `--json`, not only when something looks
wrong:

> This counts requests and tokens in the window; it cannot say how many requests remain. No
> `BudgetObservation` field records the operator's actual billing anchor date (the period above
> approximates it, it does not read it) or the plan's quota size — refarm does not know either
> today.

Two things follow from this:

- **The default period is a rolling 30-day window, not a calendar month**, because a calendar
  month silently assumes the billing anchor is the 1st — true for almost no subscription. The
  window makes no claim about which day of the month the quota refills; "usage in the last 30
  days" is true regardless. `--period month` / `--period YYYY-MM` remain reachable for a reader
  who does know their anchor is the calendar boundary — not deleted, just not the default.
- **A usage count is not a remaining-quota figure.** `refarm budget usage` can say "29 requests
  in the last 30 days." It cannot say "you have N left," because no field on any record names
  the plan's request ceiling. That number lives with the subscription vendor, not in this graph.

---

## Coverage: this is a partial record, and the partiality is countable

Reading a total from this record without reading its coverage would understate every axis by
however much of the record predates that axis. Measured live, 2026-08-08, 29 observations
total:

| Axis | Coverage | Detail |
| --- | --- | --- |
| `refarm.workspace.id` (attributed) | **8/29** | `refarm` ×5, `rcdc5` ×3; 21 unattributed |
| `host.id` (identified) | **22/29** | 1 identified node has not declared a name |
| `host.name` (named) | **21/29** | 22 identified minus 1 unnamed |
| `refarm.cost.price_known` | **26/29** | 3 records predate that field entirely (absent, not `false`) |
| `refarm.pricing_mode` | 29/29 | all `"subscription"` |
| `gen_ai.usage.output_tokens` | 29/29 | sums to 590 |

Attribution (`refarm.workspace.id`) shipped 2026-08-05; node identity (`host.id`/`host.name`)
and `price_known` (F5) shipped on different days again — each field's coverage is bounded by
when it started being written, not by any defect in reading it back today. `refarm budget
by-workspace`, `by-host`, and `summariseObservations`' own summary all expose these gaps as
named counts (`unattributed`, `unidentifiedRecords`, `unnamedNode`, `priceUnknown`) rather than
silently folding a partial axis into a total that looks complete.

---

## What this does NOT cover

**590 output tokens is the entire refarm ledger, spanning 2026-08-04T00:21Z to
2026-08-05T20:29Z — under two days.** `refarm budget` only ever sees a `BudgetObservation`,
and one is written only for effort refarm itself dispatches (`refarm ask`, and the
`capability-dispatch` spawner). Work that never went through that path leaves no trace here at
all.

The session that built this feature (three tasks, `817bcd08`..`ad216c7e`, plus this recording
task) spent roughly **6.5M subagent tokens**
(`docs/superpowers/plans/2026-08-08-what-did-this-cost.md:32`, the plan's own opening
measurement) — none of it in the `BudgetObservation` record, because refarm did not dispatch
any of it. That gap is not a defect in this feature; it is the reason the operator sequenced
the ingestion question *after* the queries: "the queries work identically over 29 records or
29 million, and they become the instrument that shows whether ingestion is working when it
lands" (same plan). This document's numbers — 590, not 6.5M — are the honest current scope of
what `refarm budget` can see, not a claim that it sees the operator's total cost.

The open question this leaves (`.project/handoff.json`, open_questions): should the record
cover work refarm did not dispatch at all? Either refarm accepts observations from outside over
a wire contract, or it continues to state plainly — as `refarm budget observations`' own
empty-record message and this document both do — that it measures only what it dispatches.

---

## See also

- `docs/superpowers/specs/2026-08-03-budget-laboratory-design.md` — D1–D9, the record shape
  this reads (`refarm.pricing_mode`, `refarm.cost.*`, `refarm.budget.*`, `gen_ai.usage.*`).
- `docs/superpowers/plans/2026-08-08-what-did-this-cost.md` — the plan this doc records the
  delivery of, including the 590-vs-6.5M measurement cited above.
- `apps/refarm/src/commands/budget.ts` — the implementation; its own header and per-function
  comments are the authoritative, line-cited source for every mechanism summarized above.
- `docs/SANDBOX_NODE.md` — a second node whose own `BudgetObservation`s currently lack
  `refarm.workspace.id`/`host.name` for a different reason (no `SovereignConfig` node in that
  graph), queued separately from the coverage gaps recorded here.
