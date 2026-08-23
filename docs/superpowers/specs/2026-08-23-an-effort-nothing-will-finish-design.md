# An effort nothing will finish, and nothing can name

**Date:** 2026-08-23
**Lane:** [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — the node as daily driver
**Serves:** ISS-077 item 2, the only half of it still open after item 1 was measured as shipped.
**Pairs with:** ISS-039 (UsageRecord is never reaped), ISS-104 (`agent probe` writes an effort trail),
and the ConfigNodeAuditor gap named at the end of `CONVERGENCE-LANE.md` — which this design runs
into and must not build on.

## What forced this

ISS-077 says "nothing resumes a persisted non-terminal effort". Measured on the operator's live node
rather than taken from the entry:

```
task 18c857e02f2d2fc70016   status: active   updated_at: 2026-08-03 16:17:52
title: "Por que o teste observer::tests::rotate_seals_the_full_file... falha"
```

Twenty days. Through the reboot of 2026-08-21 and every daemon restart since. And in the same
breath:

```
$ refarm task list
Efforts: total=0 pending=0 in-progress=0 done=0 partial=0 failed=0 timed-out=0 cancelled=0
```

**Nothing resumes it is the smaller half. Nothing NAMES it is the larger one.** To anything reading
its status, that task is indistinguishable from one running right now.

## Measure first

### Two records, and they diverge by design

| record | where | lifetime |
| --- | --- | --- |
| the sidecar's **effort** | `EffortStore` = `Arc<RwLock<HashMap<..>>>`, plus `~/.refarm/task-results/<id>.json` | in memory while in flight; a file appears only when `record_effort_result` runs — that is, only when a RESULT lands. `reap.rs` removes the file afterwards. |
| the graph's **Task** node | `~/.refarm/data/refarm/default.db` | written by the agent side, and nothing moves it out of a non-terminal state if the effort dies |

So an effort that never completes leaves **no file** (`load_persisted_efforts` finds nothing at
startup) and **a permanent `active` Task** in the graph. The two halves of one operation disagree,
and the disagreement is invisible from both sides: the sidecar honestly reports zero because it has
zero; the graph honestly reports `active` because nobody told it otherwise.

Measured on the node: `~/.refarm/task-results/` holds **0 files**; the graph holds **82 Tasks**, of
which `active|1  done|57  failed|24`.

### The status vocabulary already says why this is wrong

`packages/tractor/src/sidecar/mod.rs` documents `in-progress` as "the sidecar's own work is running
(a dispatch task is live)". A dispatch task is live **in a process**. And it names `active` as
legacy vocabulary that "lied (it read as in-progress but consumers had no such state)". The one
stuck record on the node carries exactly that retired word.

## The invariant this design rests on

> **An effort that has been non-terminal since before the current process started cannot be
> running.** `in-progress` asserts a live dispatch task; this process did not exist then, so
> whatever owned it is gone.

It is decidable from two facts the node already has — the effort's last update and the daemon's
start — and it needs no policy, no guess about intent, and no new state in any store.

## D1 — name it before resuming it

**Resumption is not the first slice, and building it first would be building on a name that does not
exist.** You cannot re-run, fail, or report an effort that nothing enumerates. Worse, "resume" hides
genuinely hard semantics that deserve their own decision and not a default:

- the plugin call that owned it is gone — re-dispatch, or declare it failed?
- its budget was already spent; a re-dispatch spends again (ISS-039's ledger is the record of that)
- if it was waiting on a prompt, the answer may have landed since (ISS-077 item 1, shipped)

Every one of those is a policy question. **`abandoned` is a fact**, and the fact is what makes the
policy discussable.

## D2 — report, never rewrite

The stuck Task must NOT be silently transitioned to `failed`. It is the operator's record of work
that was really attempted, and rewriting a history so it reads tidy is the decision taken against
in ISS-121 the same day: the six BudgetObservation/TaskEvent/UsageRecord rows carrying a test's
sentinel stay, because they are true.

A verdict is added beside the status, not on top of it.

## D3 — where it cannot go yet, and this is the blocker

The natural surface is `refarm health`, beside the two facts added the same day (the installed
node's age, the branch's unpushed work). **It cannot go there yet.**

`packages/health`'s `ConfigNodeAuditor` reaches the graph through a client that requires `@context`;
the Rust sidecar never sets it; a `try/catch` turns the throw into a soft "skipped" note. That is
recorded at the end of `CONVERGENCE-LANE.md` as *"`refarm health` contains a check that has always
passed by never running"*, and it deserves its own spec.

Building this on that path would put a new fact behind a guard already known not to fire — the exact
shape AGENTS.md §9 was written to stop, two days after writing it.

And `refarm task list` is not the surface either: it reads the sidecar over HTTP
(`fetchSidecarWithTimeout(sidecarUrl("/tasks"))`), which is precisely the store that legitimately
holds zero.

## The order this implies

1. **Fix the graph read** (the ConfigNodeAuditor `@context` gap). Not this design's work, but this
   design's precondition — and it unblocks more than this.
2. **Name the abandoned effort.** A pure classifier over (last update, process start), surfaced
   wherever step 1 makes the graph legible. Severity `info`: an abandoned effort is not a fault of
   the node's, it is a fact about work that stopped.
3. **Then decide resumption**, with the three policy questions in D1 answered separately and each
   one measured against a node that can finally list what it would be resuming.

## What is NOT proposed

- No new store. Both records exist; what is missing is a reading across them.
- No sweep, no garbage collection. Same reason `OperationQuestion` expires by time and is reported
  rather than swept: a record that vanishes cannot say the node failed to keep a commitment.
- No change to the effort status vocabulary. `abandoned` is a VERDICT computed on read, not a
  seventh state anybody writes.
