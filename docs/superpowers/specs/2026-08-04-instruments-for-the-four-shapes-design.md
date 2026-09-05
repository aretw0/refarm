# The four shapes a defect took in one program, and the instruments that would have caught them

Date: 2026-08-04
Status: DESIGN — the findings are measured rather than argued; the operator approved building the
three instruments after seeing the tally. Awaits an implementation plan.
Touches `scripts/ci/**`, `packages/health/**`, and reads across every contract package.
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md), the interfaces/devices/nodes lane

## What forced this

The budget laboratory shipped in thirteen tasks. Every task had its own review, three needed fix
rounds, a whole-branch review followed, and a fix wave closed what it found. That process worked: it
caught two Critical defects and five Important ones before merge.

It also let six defects of one particular shape through every gate, and they were found by a person
looking sideways rather than by any instrument. That is the finding. **A process that depends on
someone noticing does not survive the surfaces this repository is about to grow.**

Counting what actually went wrong, the defects were not varied. They were four shapes, repeated.

### Shape 1: an instrument reports success it did not earn

| Instance | What it did |
| --- | --- |
| `packages/health`'s `ConfigNodeAuditor` | Its whole purpose is cross-device config-drift detection. The graph read threw on every call, a `try/catch` turned the throw into a soft "audit skipped" note, and it had **never validated a real replicated node**. The first time it could, it found real drift on the operator's machine. |
| The model-drift gate's source parser | Matched `model.contains("…")` inside comments, so a future explanatory comment would silently join the priced set. A parse that matched nothing would have reported a clean gate. |
| `refarm resume` | Reports the declared `daily-handoff` automation as `status: "scheduled"` with a computed fire key, and **nothing executes it** — zero systemd timers, no crontab. It is the first command every agent is told to run. |

The mechanism is identical in all three: **"I could not check" collapsed into "I checked and it is
fine."** An auditor has three states, not two — checked and clean, checked and found something, and
could not check, and the third was invisible in each case.

The same rule this program enforced on data (absent is not zero) applies to **verdicts**, and nothing
was enforcing it.

### Shape 2: written, correct, and unreachable

Six instances, each one a layer that worked in isolation and connected to nothing.

| Instance | The gap |
| --- | --- |
| The three-level budget fold | Its one production caller passed `None` for the workspace level. |
| The token and spend guards | Nothing carried a resolved ceiling from the node to the WASM guest. |
| The cumulative accumulator | Never reset between runs, so it measured the plugin's lifetime rather than a run's. |
| The whole budget system | No surface could declare a budget; `refarm dispatch` had no flag. |
| `Effort.workspace_id` | Declared on the wire, consumed by the resolver, recorded by the observation — and **set by nobody**. |
| Node identity | The record cannot say which node executed the work, while the store replicates across the mesh. |

**No task review caught any of them, and not through carelessness.** Each review reads its own diff,
and the defect lives in the absence of something outside it. Four were found while preparing the
*next* task, the only moment anyone holds two layers at once. One came from the whole-branch review.
One came from the operator describing the end state out loud.

### Shape 3: two sources for one answer

Six instances: a vestigial `source` field beside `bound_by`; a provider read from the environment
while the correct one sat in scope; a proposed new `SidecarState` field beside the existing
`declared_base()`; a copied helper beside a re-export; a plain config read beside the crate's hardened
reader; `BudgetDeclaration` transcribed into three places.

In **every** instance the correct fix made the code smaller, and the obvious move was to add rather
than to reach. The asymmetry that decides it: **reaching for the single source fails loudly when it
becomes superfluous** (`cargo check` flags the unused re-export) **while duplicating rots in
silence.**

### Shape 4: correct documentation that aged into falsehood

| Instance | Was true when written |
| --- | --- |
| The rate table's model branches | Stopped at Claude 4, so every Claude 5 id fell through to the value meaning "local, free". Two more rates were simply stale: Haiku 4.5 carried Haiku 3.5's retired price, and Opus 4.5 inherited Opus 4's, over by three times. |
| `pnpm-workspace.yaml`'s security overrides | Pinned to boundaries a later advisory moved past. A security fix that expired in silence, in a file whose comments are otherwise exemplary. |
| The `brace-expansion` compatibility note | Argued at length, with evidence, that 5.x breaks `style-dictionary`. The ecosystem moved; `minimatch` now uses the named export; the note was false and still convincing. |

None of these was sloppy. All three were written carefully, with reasons recorded. **They rotted
because nothing re-compared them against the world**, and the only defence that worked was someone
opening the vendor's page.

## The design

Three instruments, one per shape that an instrument can catch. Shape 2 gets the first because it is
the most expensive and the least visible.

### D1. A reachability gate: every declared field has a producer and a consumer

For each field of a versioned wire contract, ask two questions of the tree: **does anything set it,
and does anything read it?** A field with a consumer and no producer is Shape 2 exactly —
`Effort.workspace_id` would have failed it from the day it was added.

The gate reports three states per field, mirroring D2 below rather than inventing a vocabulary:
`reachable` (both), `unreachable` (consumer, no producer), `unread` (producer, no consumer). The last
is not always a defect — a field can be written for a consumer that does not exist yet, so `unread`
carries a declared reason or fails.

**Technique**: source scanning, following `scripts/ci/check-model-defaults-drift.mjs`, which already
reads Rust and TypeScript as text and gained a parse-sanity floor for exactly this reason. It is
imperfect by construction: a field set through a dynamically built key will be missed. That is
acceptable and must be stated in the gate's own output, since an instrument that overstates its
coverage is Shape 1 wearing a new hat.

**Baseline**: a shrinking one, like `scripts/ci/model-defaults-price-baseline.json`. Today's
unreachable fields are enumerated and dated; the gate fails on anything new and fails on an entry
that has since become reachable, so the list cannot rot.

### D2. Three-state honesty for every verifier

Two auditors were corrected during this program: `ConfigNodeAuditor` now emits
`config_node_unreachable` instead of a soft note, and the filesystem and project auditors now report
`applicable: false` with a reason at a node base rather than judging other people's repositories.
Both followed one convention. **Extend it to every verifier in the repository.**

The rule: a verifier that cannot check must say so in a way that reaches the operator's eyes and the
gate's exit code — never as a note beside a passing result. Concretely, audit each auditor, gate and
`check` for a `try/catch` that swallows into success, and for a code path where "no data" produces
the same output as "data, and it was fine".

**`refarm resume` is the first target**, and it deserves naming: it reports a scheduled automation
that nothing executes, and it is the first command every agent runs. Distinguishing `declared` from
`scheduled` is the cheap half; deciding whether the executor should exist is the operator's.

### D3. Every claim about the external world carries its source and its date

The rate table already does this: each branch cites the vendor's official pricing page, the table
carries `RATE_TABLE_VERSION`, and every observation records which version priced it. That pattern
exists because fetching the citations *was* the audit that found two wrong rates.

Extend it to the two other places the same rot appeared: **dependency overrides** (each pin records
the advisory it answers and the date it was verified) and **compatibility notes** (each records what
was observed, where, and when). Then a periodic re-verification has something to re-verify against.

**What this does not do**: automate the re-check. A gate that re-fetches vendor pages in CI would be
flaky, slow, and dependent on the network. The instrument here is the *record*, and the re-check is a
declared, scheduled human-or-agent task — which is itself a good first customer for whatever ends up executing
`daily-handoff` once D2 forces that question.

## What this deliberately does not attempt

Shape 3 (two sources for one answer) gets no instrument. Six instances, and in every one the fix was
obvious once seen — the difficulty was noticing, and a detector for "these two things answer the same
question" is a semantic judgement no text scan can make honestly. The mitigation already exists and
is cheaper: contract packages with conformance suites, which is why the TypeScript and Rust budget
folds agree across seven checks. **Where a shared truth matters, put it in a contract package and make
both sides prove against it.** That is a habit, not a gate, and this document says so rather than
pretending otherwise.

## Open questions

- **Does the reachability gate scan contracts, or everything?** Scoping it to `*-contract-v1`
  packages' declared fields is tractable and covers where Shape 2 hurt. Scoping it to every public
  field of every package is more complete and probably unaffordable. Start narrow and say so.
- **What executes a declared automation?** D2 forces the question by making `refarm resume` stop
  claiming a scheduler exists. Answering it — systemd timer, the node's own loop, or removing the
  concept — is the operator's decision and is out of this design's scope.
- **Should `unread` fail by default?** A produced-but-unconsumed field is how a contract grows before
  its consumer lands. Failing it would punish exactly the sequencing this repository uses. Requiring a
  declared reason is the middle ground, and whether that reason lives in the baseline file or beside
  the field is undecided.
