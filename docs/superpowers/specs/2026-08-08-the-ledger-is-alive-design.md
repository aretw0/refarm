# The Ledger Is Alive

Date: 2026-08-08
Status: proposed
Related: `.project/schemas/issues.schema.json`, `scripts/ci/project-block-consistency.mjs`,
`docs/OPERATOR_REQUIREMENTS.md` (requirement 1), `docs/SOVEREIGN_RECORD_ORDERING.md`,
2026-08-03 budget-laboratory design (the three-states precedent)

## Why this exists

The operator asked on 2026-08-08 to close every remaining granularity hole across the node /
workspace / sandbox / cost axes, and offered to accept a legibility fix first if the project was hard
to read. It is hard to read, and the reason is measurable rather than aesthetic.

**This spec does not fix any of those four axes. It makes them countable.** Every item below is about
the record of the work, not the work. That distinction is deliberate: the four axes cannot be
finished while nobody can say how many items they contain.

## What was measured, not argued

### 1. The agent's own entry point hides 79% of the record, silently

`CLAUDE.md` §4 mandates `refarm resume --json` at the start of every slice. On 2026-08-08, against
the live `.project/handoff.json`:

| Field | In the file | Returned by `resume --json` | Hidden |
| --- | --- | --- | --- |
| `current_tasks` | 24 | 5 | 19 |
| `next_actions` | 24 | 5 | 19 |
| `open_questions` | 6 | 5 | 1 |
| `blockers` | 4 | 4 | 0 |

Cause: `apps/refarm/src/commands/resume.ts:257` passes `arrayLimit: 5`;
`packages/cli/src/project-handoff.ts:75` applies `items.slice(0, limit)`. The success envelope
carries no `truncated` field, so **a complete read and a 21%-complete read are indistinguishable to
every consumer, including the agent that is told to trust it.**

This is the same defect shape this line of work has now catalogued nine times — the handoff itself
records the seventh, inside the fix for the sixth: *"the budget guard's own re-query discarded its
second page's `truncated`, so Known could still be built from an incomplete read."* This instance is
the one at the front door.

It also explains the decay without appealing to discipline: the queue looked like five items because
nineteen were invisible. Nobody triages what they cannot see, and each slice appended to the head of
a list whose tail was never read back. The prose reached **54,300 characters** across four fields.

### 2. The granular ledger exists, is schema-governed, and has been dead since May

```
.project/tasks.json         373 entries · 100% completed · last touched 2026-05-05
.project/issues.json         22 entries · 20 resolved, 2 open (both from May)
.project/requirements.json   31 entries
.project/schemas/            13 JSON schemas governing all of it
.project/handoff.json        last touched 2026-08-08
```

A 373-task ledger at 100% completion is not a finished project. It is a ledger that stopped
receiving work — the same two-states-where-three-belong collapse: *no open tasks* and *nobody is
recording tasks* produce the identical value.

### 3. Only documents with a CLI writer survived

`refarm project` governs exactly two documents:

| Document | Writer | Outcome |
| --- | --- | --- |
| `handoff.json` | `project handoff validate\|write` | alive, touched today |
| `automations.json` | `project automations validate\|list\|add\|set-status\|tick` | writer exists, file not yet created |
| `tasks.json` | none | dead since 2026-05-05 |
| `issues.json` | none | dead since 2026-05-05 |
| `requirements.json` | none | dead |

This is structural, not cultural. A governed document with no writer can only be edited by hand, and
nobody hand-edits a 373-entry JSON file mid-slice.

### 4. The CI gate passes green on a dead ledger

`scripts/ci/project-block-consistency.mjs` verifies unique ids, `requirements.traces_to → tasks`,
`tasks.depends_on → tasks`, and `tasks.verification → verification`. All intact. It measures
**referential integrity** and never **freshness** or **coverage**, so it has no way to observe that
the document stopped receiving reality. Every check it performs is internal to the documents; none
has an external anchor.

### 5. The prose contradicts itself, in two places

Because a struck item is annotated in a different paragraph from where it is written:

- `next_actions[2]`: *"Also RESOLVED: declaredBase()'s fallback — item (5) of the
  workspace-is-not-a-node loose-ends entry below"*
- `next_actions[3]` item (5): *"THE OPERATOR'S DECISION, still open"*

Same for `workspace sync` rooted at cwd: recorded as fixed in `f98a799a` in one entry, and as
*"fold into the-node-answers-for-itself plan"* in another.

### 6. One blocker is stale by two days

`blockers` still carries *"DURABILITY GAP 2: there has never been a requirements interview."* Commit
`80df1537` (2026-08-06) created `docs/OPERATOR_REQUIREMENTS.md`, 430 lines, opening with *"a partir
da primeira entrevista explícita com o operador"*. The blocker was true on 2026-08-05 and has been
false since 2026-08-06.

### 7. The loose ends are in three fields, not one

| Location | Named items |
| --- | --- |
| `next_actions` | 15 (2 self-contradicting) |
| `blockers` | 4 (1 stale) |
| `open_questions` | 6 (1 decided 2026-08-08) |
| `current_tasks`, inside "SHIPPED" narratives | 4 sandbox items — no `stop` subcommand, the `--reset`/`start` TOCTOU race, the `tractor.engine` `rust`↔`auto` divergence `parity` found and did not fix, and the `openai-codex` token that expires with nothing refreshing it on either node |
| **Total** | **~29 against the 5 the agent sees** |

## Decisions taken with the operator on 2026-08-08

1. **Axis first, then the axes.** Rebuild the living ledger before touching node-vs-directory, cost,
   or sandbox work.
2. **Depth C**: data migration + governed writer + a gate that can tell a current ledger from an
   abandoned one.
3. **The gate blocks the deterministic check and warns on the heuristic one.** A missing id is
   verifiable and always remediable by the agent (creating the issue is one command), so it blocks. A
   stale ledger is a judgement, so it warns. This also settles the standing open question *"Should a
   divergence the agent is FORBIDDEN to fix ever block the agent gate?"* for this gate: **block only
   what the agent can fix.**

## Architecture

### Which document means what

| Document | Meaning | Lifecycle |
| --- | --- | --- |
| `issues.json` | **Named debt, not yet scheduled.** Every loose end lives here. | `open` → `deferred` → `resolved` |
| `tasks.json` | **Work scheduled inside a plan.** Unchanged by this spec. | an issue becomes a task when a plan adopts it |
| `handoff.json` | **Short narrative that cites ids**, instead of restating prose. | rewritten each slice |

Nothing is discarded. `issues.schema.json` defines `body` as *"Full detail and context for downstream
composition"* — that is exactly where each dense paragraph goes, with `location` carrying the file
and line every prose loose end already names. This is relocation, and every rationale, rejected
alternative and measurement stays textually in the repository.

`issues.json` is the right home rather than `tasks.json` because its own schema description is
*"Known bugs, missing capabilities, design debt, and open work items"*, and because
`tasks.schema.json` requires `verification` when `status: completed` — correct for scheduled work,
wrong for debt that has not been scheduled.

### The `axis` field

`issues.schema.json` sets `additionalProperties: false` and has no axis field. Three options were
considered:

- **Reuse `package`** — semantically wrong; `package` means "which monorepo package", and `cost` is
  not a package.
- **Encode in the id** (`ISS-NODE-001`) — no schema change, but creates a second source of truth
  about the axis embedded in a string. If the axis changes, the id lies.
- **Add `axis` to the schema** — chosen. `additionalProperties: false` forces the extension to be
  deliberate, which is the right property. `package` goes back to meaning a package, and ids stay
  sequential from `ISS-023`.

```
axis: "node-vs-directory" | "cost" | "sandbox" | "durability" | "other"
```

**`axis` is optional in the schema and required by the gate for `status: open`.** The 22 legacy
entries do not break, and no open issue is unclassified. The two legacy open issues receive `other`
rather than an invented retroactive classification.

**`resolved_by` becomes gate-required when moving to `resolved`.** The field already exists in the
schema. Without the requirement, "resolved" is an assertion without proof — the exact defect the two
prose contradictions already exhibit.

### The writer

`refarm project issues validate | list | add | set-status`, mirroring the adjacent `automations`
command line for line: same `ok` / `nextCommand` / `nextCommands` envelope, same `--json`, same
`--dry-run` on `add`. This is not new design; it is the pattern already in the file, which keeps
review cost low and behaviour predictable.

```
refarm project issues list --axis node-vs-directory --status open --json
refarm project issues add --id ISS-042 --axis cost --location apps/refarm/src/commands/budget.ts:118 ...
refarm project issues set-status --id ISS-042 --status resolved --resolved-by <commit>
```

### The gate's third state

Two new checks in `scripts/ci/project-block-consistency.mjs`, both with an **external anchor** —
which is precisely what today's checks lack:

1. **Cross-document integrity, handoff ↔ issues (BLOCKS).** Two directions, both deterministic and
   requiring no prose interpretation:
   - every `ISS-\d+` cited in `next_actions` or `blockers` exists in `issues.json`;
   - every entry in `next_actions` and `blockers` cites **at least one** issue id.

   The second direction is what makes the migration load-bearing: a slice that writes a new prose
   loose end without creating its issue breaks the gate. **The reverse rule — every open issue must
   appear in the handoff — is deliberately NOT adopted**, because with ~29 open issues it would
   force the handoff back into the bloat this spec exists to end. The handoff cites what this slice
   is about; `issues.json` holds everything.
2. **Freshness anchored in git (WARNS).** If commits landed since `issues.json` last changed and no
   issue changed state, the ledger is possibly stopped. This is the signal that would have fired in
   June.

### Truncation declares itself

`resume --json` keeps `arrayLimit: 5` as a display default — the agent does not need 54,300
characters at every slice start — but the envelope gains, per field, the total and the returned
count, so a truncated read is never mistaken for a complete one:

```json
{ "project": { "nextActions": [...5 items...],
               "truncation": { "nextActions": { "returned": 5, "total": 24 },
                               "currentTasks": { "returned": 5, "total": 24 } } } }
```

with `nextCommands` naming the command that returns the rest. Three states, never two: complete,
truncated-and-said-so, unreadable.

### What the phone asks

`refarm resume --json` gains a `ledger` block:

```json
{ "ledger": { "open": 29,
              "byAxis": { "node-vs-directory": 14, "cost": 5, "sandbox": 4, "durability": 6 },
              "stale": false,
              "lastMovement": "2026-08-08" } }
```

The `byAxis` figures above are **shape, not measurement** — the real per-axis split is produced by
the migration itself, and the migrated count is what the live proof below checks. `nextCommands`
points at the axis with the most open items. This is requirement 1 of
`docs/OPERATOR_REQUIREMENTS.md` — *"saber o que demanda sua atenção e por quê"* — becoming a number
instead of prose, answerable from Termux.

## Truth cleanup, by measurement

Three corrections that only become honest during migration:

- **Kill the stale interview blocker** (`OPERATOR_REQUIREMENTS.md` exists since `80df1537`).
- **Resolve the two contradictions by reading the code**, not the prose that disagrees with itself.
  Item (5) and the `workspace sync` rooting each get a measured verdict, and the migrated issue
  records which measurement decided it.
- **Migrate blockers and open questions too**, each as an issue with its own category, so "what is
  left" is one number rather than three lists.

## Error handling

- A malformed `issues.json` fails `validate` with the schema path, never a partial normalisation.
- The freshness check cannot read git (shallow clone, no `.git`) → reports `unknown`, never `fresh`.
  Same rule as everywhere else in this repo: absence of evidence is its own state.
- `set-status --status resolved` without `--resolved-by` refuses before writing.
- `add` with a duplicate id refuses; the CI gate already treats duplicate ids as an error and the
  writer must not be able to create one.

## Testing

- **Writer**: vitest mirroring `automations`' existing tests — pure normalisation, refusals,
  `--dry-run` writing nothing, envelope shape.
- **Gate**: fixtures for each verdict — cited id missing, orphaned open issue, open issue with no
  `axis`, resolved with no `resolved_by`, git unreadable → `unknown`.
- **Truncation**: a handoff fixture with more entries than the limit must return counts that do not
  match, and one at exactly the limit must not falsely claim truncation.
- **Live proof**: `refarm resume --json` on the operator's real handoff must report
  `total: 24` for both truncated fields, and `refarm project issues list --status open --json` must
  return the migrated count.

## What is NOT in this spec

- No fix to any node-vs-directory, cost, sandbox or durability item. They become countable here and
  get fixed in their own slices.
- No change to `tasks.json`, `requirements.json`, or their schemas.
- No new document. Everything reuses what `.project/` already governs.
- No budget ingestion. That remains open question #2, unchanged.
