# The Work Item Ledger

**What this is**: the contract for `refarm issues` — the workspace-scoped, provider-agnostic record of
named debt. Design: [`docs/superpowers/specs/2026-08-08-the-ledger-is-alive-design.md`](superpowers/specs/2026-08-08-the-ledger-is-alive-design.md).

**Measured on 2026-08-09, after the migration that created this document**:

```
$ refarm issues list --workspace refarm --status open --json
open: 54 | unclassified: 0
  node-vs-directory: 16 · other: 15 · cost: 11 · durability: 7 · sandbox: 5
```

Those numbers were produced by counting, not asserted in advance. Rerun the command rather than
trusting this paragraph — the point of the ledger is that "what is left" is a number you can take
again.

---

## 1. What a work item is, and what it is not

A **work item is named debt that is not yet scheduled**. It has a title you can scan, a body that
carries the full reasoning, and a `location` that says where in the tree it lives. It is *not* a plan,
not a promise, and nothing about it says anyone is going to do it.

Three documents, three meanings:

| Document | Meaning | Lifecycle |
| --- | --- | --- |
| work items (`.project/issues.json` via any adapter) | **Named debt, not yet scheduled.** Every loose end lives here. | `open` → `deferred` → `resolved` |
| `.project/tasks.json` | **Work scheduled inside a plan.** | a work item becomes a task when a plan adopts it |
| `.project/handoff.json` | **Short narrative citing qualified ids.** Rewritten each slice. | ephemeral by design |

**An item becomes a task when a plan adopts it.** Until then it sits in the ledger and costs nothing
but a line. This is what lets the ledger hold 54 open items without becoming a to-do list nobody can
face: the handoff says what *this slice* is about, the ledger holds everything else.

What a work item is **not**:

- **Not a summary.** `body` carries the full original prose — measurements, rejected alternatives, the
  "this did not survive contact with the code" findings. The migration that populated ISS-023…ISS-082
  was relocation, not summarisation: shortening a body would have destroyed the only reason for moving
  it out of the handoff.
- **Not a status report.** A resolved item is kept, never deleted, with `resolved_by` naming the commit
  or reference that closed it. ISS-065 is a blocker that had been false for two days; it lives on as
  `resolved`, because a stale record that vanishes teaches nothing.
- **Not project-local.** The ledger is addressed by workspace through the node's declared catalog, so
  the same command answers from `/tmp`, from the repository, or from another workspace's checkout.

## 2. The four axes

`axis` is **optional in the schema and required by the gate for `status: open`** — so the legacy
entries stay valid, and no new open item can be unclassified.

| Axis | What belongs in it |
| --- | --- |
| `node-vs-directory` | Anything that confuses *the node* with *the directory the operator is standing in* — resolvers that read `process.cwd()`, catalogs rooted at the wrong place, the two languages' base resolvers disagreeing. |
| `cost` | The record of what work cost and who it was for: workspace attribution at the origin, the budget guard, the pricing modes, the quota denominator. |
| `sandbox` | The isolated second node and the instruments that compare it to the operator's — the seven declared axes, `refarm parity`, what the lab does *not* isolate. |
| `durability` | Whether the record survives: knowledge that lives only on one machine, gates that cannot fail, credentials that expire with nothing refreshing them, branch protection that was never applied. |
| `other` | Everything that genuinely fits none of the four. |

**`other` is a real answer, not a failure.** The record-reading family (discarded `truncated` flags,
two sort orders for one fact, unpaged responses) is 15 of the 54 open items and belongs to no axis
above; stretching one of them to cover it would have made the per-axis count a fiction. If an item
fits nothing, `other` is correct and honest.

## 3. The four commands

The contract names four operations — `list · add · setStatus · validate` — and all four are built.
A fifth subcommand, `set-axis`, exists because classification is a different question from lifecycle:
see the note at the end of this section.

**`list`** — defaults to `--status open`; reports `count`, `unclassified`, the adapter's capability
table, and `extraFields` (document keys the contract does not model):

```bash
refarm issues list --workspace refarm --status open --json
refarm issues list --workspace refarm --axis node-vs-directory --json
```

**`list --all-workspaces`** — every declared workspace, **grouped and never merged**, with a named
`unreadable` bucket for any adapter that fails. A failing workspace is never an omission and never a
zero:

```bash
refarm issues list --all-workspaces --json
# → { "workspaces": { "refarm": { "provider": "project-json", "count": 54, … },
#                     "rcdc5":  { "provider": "project-json", "count": 20, … } },
#     "unreadable": {} }
```

**`add`** — every required field explicit; `--dry-run` validates without writing. Bodies contain
quotes, backticks and newlines, so a scripted migration passes an argv array (`execFileSync`) and never
a shell string:

```bash
refarm issues add --workspace refarm --id ISS-085 --axis cost \
  --title "…" --body "…" --location apps/refarm/src/commands/budget.ts:118 \
  --category issue --priority high --package apps/refarm --json
```

**`set-status`** — refuses `--status resolved` without `--resolved-by`, because "resolved" without
proof is an assertion:

```bash
refarm issues set-status --workspace refarm --id ISS-032 --status resolved --resolved-by f98a799a
```

**`set-axis`** — classifies an item that already **exists**. It is a separate verb rather than an
`--axis` flag on `set-status` because the two answer different questions: `set-status` moves an item
through its lifecycle and refuses to resolve without proof, while classification is legal at any
status. Folding them together would force a caller reclassifying an open item to restate
`--status open` — a write of a value it did not intend to change:

```bash
refarm issues set-axis --workspace refarm --id ISS-083 --axis durability --json
```

An axis outside the declared set is refused **before any write**, in the CLI *and* again in the
adapter, so an unknown axis cannot reach the document from either door. Reclassifying keeps every
other key the record carries — including fields this contract does not model, such as rcdc5's
`description` — and puts a newly-added `axis` in the same position `add` would have.

**`workspaceFrom` and `providerFrom`** — every successful resolution reports two provenance fields,
independent of each other:

```json
{ "workspaceFrom": "flag" | "cwd-match" | "enumerated", "providerFrom": "declared" | "convention" }
```

`workspaceFrom` answers *how the workspace was selected*: `"flag"` for an operator-typed
`--workspace <id>`, `"cwd-match"` when the flag was omitted and the current directory matched the
declared catalog, `"enumerated"` on the `--all-workspaces` batch path (the caller looked up the id
itself — there is no flag to read). `providerFrom` answers, independently, *how that workspace's
work-item provider was found*: `"declared"` when the catalog names one, `"convention"` when none is
declared but `.project/issues.json` exists at the workspace root anyway. A workspace chosen by
`cwd-match` can still have a `declared` provider, and one chosen by `flag` can still fall back to
`convention` — the two facts do not determine each other, which is why they are two fields, not one
(see the design spec's 2026-08-09 erratum for the collapsed single-field shape this replaced).

A workspace that declares a provider with **no adapter built yet** (`github`, `gitlab` — mapped in
section 5's table, not implemented) refuses distinctly, naming both the declared provider and the
providers that are implemented, rather than silently falling through to the convention path:

```json
{ "ok": false, "error": "provider_unsupported",
  "message": "This workspace declares provider \"github\", which has no adapter yet. Implemented: project-json." }
```

**`validate`** — reads the ledger through the adapter and checks exactly what the gate enforces:
duplicate ids, open items with no `axis`, resolved items with no `resolved_by`. It refuses an
unreadable document rather than reporting an empty clean ledger, and reports `extraFields` as
**information, never a finding** — rcdc5's `description` is legitimate. Each finding comes back with a
runnable remediation in `nextCommands`:

```bash
refarm issues validate --workspace refarm --json
# valid → ok: true with counts; invalid → ok: false, error "invalid_ledger", exit 1
```

The cross-document check between the handoff and the ledger is a separate gate and stays in CI:

```bash
node scripts/ci/project-block-consistency.mjs
```

### `refarm resume --json` and the ledger

`CLAUDE.md` §4 mandates `refarm resume --json` at the start of every slice, so its output is the
first thing an agent reads — and it carries two blocks this document had never named.

**`ledger`** — every declared workspace's ledger, read defensively through the same
`resolveWorkspaceLedger` the `issues` command uses (so `resume`'s counts and `issues list`'s counts
can never drift apart by walking two different paths to the same document):

```json
{ "ledger": {
    "workspaces": { "refarm": { "open": 54, "unclassified": 0, "byAxis": { "cost": 11, "other": 15 } } },
    "unreadable": {} } }
```

There is **no cross-workspace total** — summing open items across workspaces is exactly the mixing
the workspace-granularity requirement (section 4) rules out. `nextCommands` gains one more entry: an
`issues list --workspace <busiest> --json` pointing at whichever declared workspace has the most open
items, so the ledger is one hop from the command an agent is told to run first — appended AFTER the
generic recovery handoffs, never ahead of them, so a failed `finish` or a not-ready runtime stays the
most urgent thing to do.

**`truncation`** — `resume` reads `.project/handoff.json` through a 5-entry-per-field cap
(`current_tasks`, `blockers`, `next_actions`, `open_questions`), and `truncation` is the field that
makes a capped read distinguishable from a complete one:

```json
{ "truncation": { "currentTasks": { "returned": 5, "total": 24 }, "blockers": { "returned": 4, "total": 4 } } }
```

Section 7 names the shape of the defect this closes: `resume` used to return five entries per field
with no signal that 19 more existed, so a 21%-complete read and a complete one were indistinguishable
to the agent told to trust it.

**The gap that remains**, named rather than left to be discovered: there is no editor for `title`,
`body` or `location`. Correcting one is still a hand edit — the same shape of gap that killed the
ledger the first time (section 7). `axis` used to be on that list; classifying the two legacy open
items during the migration required writing the document directly, which is precisely why `set-axis`
was built before the first reclassification was made. Tracked as its own addressable item, not left
only in prose: `refarm#ISS-085`. This branch itself needed two hand edits for exactly this reason —
ISS-033's proof restore and ISS-083's correction, both dated 2026-08-09.

## 4. Why ids are qualified

Ids are qualified across workspaces — **`refarm#ISS-023`**, `rcdc5#issue-008`. Unqualified ids are
legal only inside a single-workspace command.

The reason is measured, not hypothetical. Two workspaces are declared on this node, both backed by
`project-json`, and their id namespaces differ:

| | refarm | rcdc5 |
| --- | --- | --- |
| id namespace | `ISS-NNN` | `issue-NNN` and `fragility-fragility-<hash>` |
| extra document fields | none | `description` (reported as `extraFields`) |
| `.project/schemas/` | its own | its own, and different |

`issues.schema.json` in refarm sets `additionalProperties: false`, and rcdc5's records carry
`description`: **the same backend, in two workspaces of the same node, already produces mutually
invalid documents.** A contract designed from refarm alone would have been wrong on first contact with
the second workspace.

The ids do not collide today because someone chose `ISS-` and someone else chose `issue-`, at
different times and for no shared reason. **That is naming luck, not design**, and an aggregate view
cannot depend on it. Qualification makes non-collision a property of the addressing scheme instead.

## 5. The capability table and its three states

Each adapter declares, **per field**, one of three states — and the CLI reports the degradation rather
than silently dropping a field:

- **`native`** — the backend stores this field as itself.
- **`emulated`** — the backend can carry it, but in another shape (a label, a fenced block, a closing
  reference). Round-trips, with a caveat the operator gets told about.
- **`unsupported`** — the backend cannot carry it at all. Writing it **refuses**, showing the
  capability table, rather than writing a record the backend will silently truncate.

This is the same rule the budget axis follows: a value that cannot be represented is not zero and not
absent — it is *unsupported by this backend*, and that is a third state, not a missing one.

`project-json` reports every field `native` (measured: `refarm issues list --json` → `capabilities`).
The remote mappings below are **designed, not built** — there is no `github` or `gitlab` adapter in the
tree. The table is part of the contract precisely so it was designed against real remote constraints
instead of from `project-json` alone:

| Field | `project-json` | `github` (mapped, not built) | `gitlab` (mapped, not built) |
| --- | --- | --- | --- |
| `id` | native | native (`number`), qualified as `<ws>#<n>` | native (`iid`) |
| `title` / `body` | native | native | native |
| `status` | native (`open`/`deferred`/`resolved`) | emulated — `open`/`closed` + label `status:deferred` | emulated, same shape |
| `priority` / `category` / `axis` / `package` | native | emulated via labels (`axis:cost`) | emulated via labels |
| `location` | native | **unsupported natively** — emulated in a fenced block in the body | same |
| `resolved_by` | native | emulated — closing commit/PR reference | emulated |
| `source` | native | unsupported | unsupported |

## 6. What the gate enforces

The cross-document check lives in `scripts/ci/project-block-consistency.mjs` and is **workspace-local
by nature**: it runs inside one repository and checks that repository's handoff against that
repository's ledger. It enforces two directions, both deterministic and neither requiring anyone to
interpret prose:

1. **Every `ISS-` id cited in `next_actions` or `blockers` exists in this workspace's ledger.** A
   citation that names nothing is a dangling reference.
2. **Every entry in `next_actions` and `blockers` cites at least one id.** This is the direction that
   makes the migration load-bearing: a slice that writes a new prose loose end without creating its
   work item breaks the build.

A missing id is verifiable and always remediable by the agent — creating the item is one command — so
it **blocks**. Ledger freshness, anchored in git, is a judgement, so it **warns**; and if git cannot be
read (shallow clone, no `.git`) it reports `unknown`, never `fresh`. That split is the standing answer
to the question this plan closed as ISS-072: **block only what the agent can fix.** A gate that blocks
on a condition the loop may not remedy deadlocks it and creates an incentive to bypass the gate.

**The reverse rule was deliberately rejected.** "Every open item must appear in the handoff" sounds
symmetric and is not: with 54 open items it would force the handoff straight back into the 54,300
characters of prose this whole line of work exists to end. **The handoff cites what this slice is
about; the ledger holds everything.** The asymmetry is the design.

> Status note (corrected 2026-08-09 — Finding 6): the cross-document check shipped in **this**
> branch, commit `07d3209d` (`feat(gate): the ledger gate gains an external anchor`) — not in a
> slice that follows it. The migration is what makes it passable — as of the commit that created
> this document, the handoff cites ids in every `next_actions`, `blockers` and `open_questions`
> entry, and `refarm project handoff validate --json` reports `ok: true`.

## 7. How the ledger died the first time

It was not neglect, and it was not culture. It was structural, and it is measurable:

```
.project/tasks.json         373 entries · 100% completed · last touched 2026-05-05
.project/issues.json         22 entries · 20 resolved, 2 open (both from May)
.project/requirements.json   31 entries · dead
.project/handoff.json        touched today
```

**Only the documents with a CLI writer survived.** `refarm project` governed exactly two:
`handoff.json` (`validate|write`) and `automations.json` (`validate|list|add|set-status|tick`).
`tasks.json`, `issues.json` and `requirements.json` had none — and a governed document with no writer
can only be edited by hand, mid-slice, in a 373-entry JSON file. Nobody does that. So the record
stopped receiving reality while every check on it stayed green: `project-block-consistency.mjs`
verified unique ids and referential integrity, all of which remained perfectly intact in a document
nobody was writing to. **Every check it performed was internal to the documents; none had an external
anchor.**

A 373-task ledger at 100% completion is not a finished project. It is the same two-states-where-three-
belong collapse this repository has catalogued nine times: *no open tasks* and *nobody is recording
tasks* produce the identical value.

Meanwhile the surviving document decayed in the other direction. `CLAUDE.md` §4 mandates
`refarm resume --json` at the start of every slice, and resume returned five entries per field out of
24 — with no `truncated` field, so a complete read and a 21%-complete read were indistinguishable to
the agent that was told to trust it. Nobody triages what they cannot see. Each slice appended to the
head of a list whose tail was never read back, until two entries contradicted each other (ISS-032,
ISS-033 — both resolved here by measuring the code, not by believing either paragraph) and one blocker
had been false for two days (ISS-065).

**So the gate is not bureaucracy.** It is the external anchor those checks never had: a writer so the
ledger can receive work at all, and a rule that a loose end written as prose must also exist as an
addressable item. That is the only part of this that would have fired in June.
