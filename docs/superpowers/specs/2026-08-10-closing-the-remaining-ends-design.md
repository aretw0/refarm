# Closing The Remaining Ends

Date: 2026-08-10
Status: proposed
Related: `docs/WORK_ITEM_LEDGER.md`, `docs/NO_OS_RESOLUTION.md`,
2026-08-09 which-command-answers-for-the-node design (the slice that produced most of this map),
2026-08-08 the-ledger-is-alive design (the record this reads from)

## Why this exists

The operator asked, on 2026-08-10, that no loose end be left — including ones this line of work only
found rather than caused. Six were closed the same day. **62 remain**, and they are not one queue:
they differ in who can close them, and in what would count as proof.

This document is the map. It does not fix anything. It says, per group, **what instrument would
prove the group closed**, because the alternative — working the list top-down by priority — is how a
60-item ledger becomes a 60-item ledger with different ids.

## The measurement that reframes the largest axis

`node-vs-directory` holds 16 open items, the largest axis. It is also the axis the
directory-independence probe was built for, and the probe currently reports:

```
37 probed · 30 same · 3 declared · 0 convicted · 0 unproven
```

**Zero convictions across the read-only surface, and 16 open items on the axis.** Those two facts are
not in tension; they say precisely where the remaining defects live: **the probe reads. The
remaining node-vs-directory items are in writers, in Rust, and in libraries the probe cannot reach
through a `--json` command.**

| Where the item lives | Items | Can the probe see it? |
| --- | --- | --- |
| Read-only CLI surface | — | yes, and it reports 0 convicted |
| **Writers** (`workspace add --replace`, `workspace sync`, `sources declarations`) | ISS-034, ISS-035, ISS-036 | no — running them four times per pass would mutate the node |
| **Rust** (`config_node.rs`) | ISS-023 | no — the probe spawns the TypeScript CLI |
| **Libraries** below any command | ISS-050, ISS-062, ISS-027, ISS-028 | only when a command's output happens to expose them |
| **Contract seams** with no consumer | ISS-025, ISS-026, ISS-029, ISS-031 | no — nothing observable differs today |
| **Meta** (the burn-down's own bookkeeping) | ISS-024, ISS-054 | n/a |
| **A question, not a defect** | ISS-075 | n/a |

That table is the argument for what follows: each group needs its own proof, and three of them need
an instrument that does not exist yet.

## The groups, and what would close each

### A. Writers that can destroy a declaration — needs a NEW instrument (3 items)

ISS-036 (`workspace add --replace` drops `commands`, and can destroy rcdc5's `vpn` and
`code-boundaries`), ISS-035 (`sync` has no `--replace`, and `source` is written but never read),
ISS-034 (`sources declarations` advises the abolished shape in the abolished place).

**Proof needed:** a round-trip harness — declare, mutate, re-read, and assert nothing the operator
declared was lost. The directory probe cannot do this by construction: it runs each command four
times per pass and a writer would mutate four times.

**Shape:** `scripts/declaration-round-trip.mjs`, operating on a **sandbox node** (`REFARM_HOME` in a
temp dir, the launcher `scripts/refarm-sandbox.mjs` already exists), so the operator's real catalog
is never the fixture. This is the same separation the sandbox slice built for cost.

### B. The Rust half of the node — needs the probe's Rust counterpart (1 item)

ISS-023: `config_node.rs`'s `declared_base()` is a second Rust base resolver that still falls back to
`current_dir()`, and the guarantee holds only because `run_daemon` sets `SOVEREIGN_BASE` in-process
first — and skips doing so when `refarm_dir.parent()` is `None`.

**Proof needed:** the daemon answering identically when started from different directories. Today's
probe measures the CLI; this is the host. **Cheapest honest version:** start the sandbox daemon from
two directories and diff `refarm parity --json` plus the node descriptor. No new Rust test harness.

### C. Libraries below the commands — provable by unit test, not by probe (4 items)

ISS-050 (`storage-fs` `scopeRoot` ignores the declared home for every consumer — this one already
wrote the working tree's `agent.wasm` into the operator's real `~/.refarm/assets/`), ISS-062, ISS-027
(`declaredBase`'s last step calls `os.homedir()` and ignores the `env` argument the first two
honour), ISS-028.

**Proof needed:** injected-env unit tests. ISS-027 and ISS-050 are the two that have already cost
something; ISS-028 is unreachable in practice and guarded in principle. **These are the cheapest
real fixes in the whole map** and they lower the ratchet, which no other group does.

### D. Contract seams with no consumer — decide, then close or strike (4 items)

ISS-025, ISS-026, ISS-029, ISS-031. Each is real and none is observable today: a trailing slash
faking a base divergence, a renamed JSON field with no consumer and no snapshot test, a `--refarm-dir`
flag with no TypeScript counterpart.

**Proof needed:** a test that fails before and passes after. **Or a decision to strike**, recorded
with its reason — a ledger that keeps items nobody will ever act on trains its reader to skim.

### E. Cost attribution at the origin — one coherent Rust slice (5 items)

ISS-058 (`workspace_source` never reaches the `BudgetObservation`, so a cwd seed silently selects
budget policy), ISS-057 (`--workspace` cannot correct an already-stamped session), ISS-059, ISS-063
(the read-failure→unknown branch has no test and is safety-critical), ISS-060.

**Proof needed:** a dispatched effort whose observation carries its provenance, taken on the
**sandbox** node so the operator's cost record is not the fixture. ISS-038 (a `nan` budget silently
disables the guard) belongs here too and is the smallest of them.

### F. The record-reading family — one slice, one shape (6 items)

ISS-040 (eight call sites discard `truncated`), ISS-041, ISS-042 (no paging past
`MAX_NODES_PER_RESPONSE`), ISS-044, ISS-045, ISS-047 (the WASM bridge materialises whole tables and
its WIT returns a bare list with no truncation signal).

**These are all one defect wearing six hats**, and it is the defect this entire line of work is
named after: a reader that returns part of the answer and says nothing. The ledger slice fixed it at
the front door (`resume`'s truncation counts); these six are the same shape further down.

**Proof needed:** a fixture larger than each limit, asserting the envelope declares what it withheld.

### G. Operator-only — cannot be closed by an agent (2 items)

ISS-071 (main has no branch protection) and the pending ruling inside ISS-054 (a prior slice touched
`.github/workflows/test.yml`, a CLAUDE.md §8 protected surface). **Naming them as agent-closable
would be the false-precision this repo keeps rooting out.** They stay open until the operator acts,
and this document is the place that says so plainly.

### H. Questions the operator owns (6 items)

ISS-064 (the quota denominator), ISS-073 (should the budget cover work refarm did not dispatch),
ISS-074, ISS-076 (which cron parser), ISS-021, ISS-022. Each changes policy rather than code.
**Proof needed:** an answer, recorded in `docs/OPERATOR_REQUIREMENTS.md` or an ADR — which is exactly
what ISS-089/ISS-090 exist to make possible.

### I. The requirements link — already designed, plan parked (2 items)

ISS-089 and ISS-090 have a written spec and a ten-task plan
(`docs/superpowers/plans/2026-08-09-requirements-join-the-ledger.md`, commit `c783c8db`), unstarted
because the operator redirected to the axes. **Closing them is what turns group H from six loose
questions into six requirement-linked decisions**, and it is the only group whose work is already
fully specified.

### J. Instruments this slice built, and their own gaps (4 items)

ISS-096 (21 read-only commands probeable and not yet probed, under a ratchet), ISS-101 (the control
pair is probabilistic), ISS-097 (the probe has no CI home), ISS-046 (diagram drift is ungated).

**Proof needed for ISS-096:** graduating commands into `PROBE_COMMANDS` and lowering
`NOT_YET_PROBED_CEILING` in the same commit — the mechanism is already built and the ceiling already
enforces it.

## The order this document recommends, and why

1. **C, then E's ISS-038** — the cheapest fixes that lower the ratchet and close two defects that
   have already cost something on disk.
2. **F** — six items, one shape, one fixture pattern; the largest reduction in count per unit of
   design.
3. **A** — the only group with a *destructive* defect (ISS-036 can eat rcdc5's declared commands),
   and it needs the new round-trip harness, so it is the first that costs design.
4. **I** — unblocks H, and its plan is already written.
5. **J's ISS-096** — mechanical, and each graduation makes the probe worth more.
6. **E's Rust remainder, then B** — the most expensive to compile on this host (CLAUDE.md §7), so
   last among the fixable.
7. **D** — decide-or-strike, cheap but needs the operator's appetite for keeping unobservable items.
8. **G and H** — surfaced to the operator, never closed by an agent.

## What this document is NOT

- **Not a plan.** No task has steps here. Each group earns its own plan when it is picked, the way
  the two slices before it did.
- **Not a promise of 62 closures.** Two are operator-only and six are questions; the honest
  agent-closable count is **54**, and D's four may end as strikes rather than fixes.
- **Not a re-triage of priorities.** The `priority` field on each item is left exactly as filed; this
  groups by *what would prove it closed*, which is a different question and the one that was missing.
