# The Ledger Is Alive

Date: 2026-08-08
Status: proposed
Related: `.project/schemas/issues.schema.json`, `scripts/ci/project-block-consistency.mjs`,
`docs/OPERATOR_REQUIREMENTS.md` (requirement 1), `docs/SOVEREIGN_RECORD_ORDERING.md`,
`docs/NO_OS_RESOLUTION.md`, 2026-08-06 a-workspace-is-not-a-node design,
2026-08-03 budget-laboratory design (the three-states precedent)

## Erratum (2026-08-09)

**What this spec said:** `LedgerResolution` reports one field, `resolvedFrom: "flag" | "cwd-match" |
"convention"`, answering both "how was the workspace chosen" and "how was the provider chosen" —
see "Workspace scope" and "Where the adapter is declared" below.

**What was found:** Task 4's implementation and its review exposed that one field conflates two
independent provenances. `--all-workspaces` resolves each declared workspace by id internally (it
has to — there is no operator-typed flag to read), so every workspace it enumerates reported
`resolvedFrom: "flag"` even though the operator passed no `--workspace` at all; and a workspace
whose provider is found by convention always reported `resolvedFrom: "convention"` regardless of
whether the WORKSPACE itself was chosen by flag or by cwd-match, silently discarding that half of
the answer. Four real combinations (workspace chosen by {flag, cwd-match, enumerated} × provider
found by {declared, convention}) do not fit into three field values.

**Corrected shape:** `LedgerResolution`'s success branch reports two fields instead of one:

```json
{ "workspaceFrom": "flag" | "cwd-match" | "enumerated", "providerFrom": "declared" | "convention" }
```

`workspaceFrom` answers how the workspace was selected (`"enumerated"` is new — the
`--all-workspaces` batch path); `providerFrom` answers how its work-item provider was found.
Every other reference to `resolvedFrom` in this document is superseded by this split; left as
written below for the historical record of what was designed, not as the current contract.

## Why this exists

The operator asked on 2026-08-08 to close every remaining granularity hole across the node /
workspace / sandbox / cost axes, and offered to accept a legibility fix first if the project was hard
to read. It is hard to read, and the reason is measurable rather than aesthetic.

He then added two requirements that changed the design rather than extending it:

1. **Platform agnosticism** — other projects may keep their work items in GitHub, GitLab or a
   corporate system, not in `.project/issues.json`.
2. **Workspace granularity** — issues from different workspaces must never mix.

**This spec does not fix any of the four axes. It makes them countable, per workspace, independent of
where they are stored.** Every item below is about the record of the work, not the work.

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

This is the same defect shape this line of work has catalogued nine times — the handoff itself
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

### 4. `refarm project` is positional, and mirroring it would have inherited that

```
refarm project handoff validate --json
  from ~/github/refarm   → ok: true
  from ~/git/rcdc5       → ENOENT .../rcdc5/.project/handoff.json
  from /tmp              → ENOENT /tmp/.project/handoff.json
```

`packages/cli/src/project-handoff.ts:100` resolves `.project/handoff.json` as a **relative** path and
`apps/refarm/src/commands/project.ts` supplies `deps.cwd()`. The first draft of this spec said the
new writer would mirror `automations` line for line; that would have reproduced the exact defect the
node-vs-directory axis exists to close. **The operator's granularity requirement is a correction to
this design, not an addition to it.**

### 5. The second ledger already exists, and the shapes already diverge

`rcdc5` is declared in the node's catalog (`~/.refarm/config.json`) with its own `.project/`:

| | refarm | rcdc5 |
| --- | --- | --- |
| issues | 22 (2 open) | **28 (20 open)** |
| id namespace | `ISS-NNN` | `issue-NNN` and `fragility-fragility-<hash>` |
| fields used | 10 | **11 — includes `description`** |
| `.project/schemas/` | its own | **its own, and different** |

`issues.schema.json` in refarm sets `additionalProperties: false`, and rcdc5's records carry
`description`. **The same backend, in two workspaces of the same node, already produces mutually
invalid documents.** A contract designed from refarm alone would have been wrong on its first
contact with the second workspace.

The ids do not collide today by accident of naming, not by design: someone chose `ISS-` and someone
else chose `issue-`, at different times. An aggregate view cannot depend on that luck.

### 6. The CI gate passes green on a dead ledger

`scripts/ci/project-block-consistency.mjs` verifies unique ids, `requirements.traces_to → tasks`,
`tasks.depends_on → tasks`, and `tasks.verification → verification`. All intact. It measures
**referential integrity** and never **freshness** or **coverage**, so it has no way to observe that
the document stopped receiving reality. Every check it performs is internal to the documents; none
has an external anchor.

### 7. The prose contradicts itself, in two places

Because a struck item is annotated in a different paragraph from where it is written:

- `next_actions[2]`: *"Also RESOLVED: declaredBase()'s fallback — item (5) of the
  workspace-is-not-a-node loose-ends entry below"*
- `next_actions[3]` item (5): *"THE OPERATOR'S DECISION, still open"*

Same for `workspace sync` rooted at cwd: recorded as fixed in `f98a799a` in one entry, and as
*"fold into the-node-answers-for-itself plan"* in another.

### 8. One blocker is stale by two days

`blockers` still carries *"DURABILITY GAP 2: there has never been a requirements interview."* Commit
`80df1537` (2026-08-06) created `docs/OPERATOR_REQUIREMENTS.md`, 430 lines, opening with *"a partir
da primeira entrevista explícita com o operador"*. The blocker was true on 2026-08-05 and has been
false since 2026-08-06.

### 9. The loose ends are in three fields, not one

| Location | Named items |
| --- | --- |
| `next_actions` | 15 (2 self-contradicting) |
| `blockers` | 4 (1 stale) |
| `open_questions` | 6 (1 decided 2026-08-08) |
| `current_tasks`, inside "SHIPPED" narratives | 4 sandbox items — no `stop` subcommand, the `--reset`/`start` TOCTOU race, the `tractor.engine` `rust`↔`auto` divergence `parity` found and did not fix, and the `openai-codex` token that expires with nothing refreshing it on either node |
| **Total** | **~29 against the 5 the agent sees** |

## Decisions taken with the operator on 2026-08-08

1. **Ledger first, then the axes.** Rebuild the record before touching node-vs-directory, cost or
   sandbox work.
2. **Depth C**: data migration + governed writer + a gate that can tell a current ledger from an
   abandoned one.
3. **The gate blocks the deterministic check and warns on the heuristic one.** A missing id is
   verifiable and always remediable by the agent (creating the issue is one command), so it blocks. A
   stale ledger is a judgement, so it warns. This also settles the standing open question *"Should a
   divergence the agent is FORBIDDEN to fix ever block the agent gate?"* for this gate: **block only
   what the agent can fix.**
4. **Platform-agnostic by contract, one adapter built.** `project-json` is implemented and exercised
   against **both** refarm and rcdc5 — real divergent schemas, real divergent fields, no network and
   no auth. GitHub and GitLab get a documented mapping table designed against their real
   constraints, and no code.
5. **Workspace scope is declared, never positional.** Issues from different workspaces never merge.

## Architecture

### The neutral contract

The core speaks **work items**, not files. One record shape, one set of operations, and adapters
translate:

```
WorkItem: id · title · body · location · status · priority · category · package · axis · source · resolved_by
Operations: list · add · setStatus · validate
```

`work item` rather than `issue` is deliberate: it is the vocabulary the vault convergence already
uses (`work-item + estado`), and it does not privilege any one platform's noun.

**Each adapter declares capability per field in three states — `native` · `emulated` ·
`unsupported`** — and the CLI reports the degradation instead of silently dropping a field. This is
the same rule the budget axis follows: a field that cannot be represented is not zero, and not
absent, it is *unsupported by this backend*, and the operator gets told.

| Field | `project-json` | `github` (mapped, not built) | `gitlab` (mapped, not built) |
| --- | --- | --- | --- |
| `id` | native | native (`number`), qualified as `<ws>#<n>` | native (`iid`) |
| `title` / `body` | native | native | native |
| `status` | native (`open`/`deferred`/`resolved`) | emulated — `open`/`closed` + label `status:deferred` | emulated, same shape |
| `priority` / `category` / `axis` / `package` | native | emulated via labels (`axis:cost`) | emulated via labels |
| `location` | native | **unsupported natively** — emulated in a fenced block in the body | same |
| `resolved_by` | native | emulated — closing commit/PR reference | emulated |
| `source` | native | unsupported | unsupported |

The mapping table is part of this spec precisely so the contract is designed against real remote
constraints rather than from `project-json` alone. Section 5 above is the evidence that designing
from one example produces a wrong contract.

### Workspace scope

`--workspace <id>` resolves through the node's declared catalog — `declaredBase()` →
`.refarm/config.json` → `workspaces[id].path` — which already knows the path of both workspaces.
**No `process.cwd()` anywhere in the resolution.**

When the flag is omitted, cwd is matched against the declared catalog and **the origin is reported**:

```json
{ "workspace": { "id": "refarm", "resolvedFrom": "flag" | "cwd-match" } }
```

A cwd matching no declared workspace **refuses and lists the declared ones**. It never falls back to
`./.project`. This follows `resolveDispatchWorkspace` (`ask.ts:820`), the repo's existing precedent
for a deliberate and documented cwd read, and honours the 2026-08-03 field failure: inferring is
allowed, inferring silently is not.

### Addressing and aggregation

Ids are qualified across workspaces: **`refarm#ISS-023`**, `rcdc5#issue-008`. Unqualified ids are
legal only within a single-workspace command.

`--all-workspaces` returns **grouped, never merged**, with three states per workspace:

```json
{ "workspaces": { "refarm": { "provider": "project-json", "open": 24, "items": [...] },
                  "rcdc5":  { "provider": "project-json", "open": 20, "items": [...] } },
  "unreadable": { "someWs": { "reason": "adapter_failed", "message": "..." } } }
```

A workspace whose adapter fails is a named bucket, never an omission and never a zero.

### Where the adapter is declared

In the workspace's catalog entry:

```json
"refarm": { "path": "...", "issues": { "provider": "project-json",
                                       "path": ".project/issues.json",
                                       "schema": ".project/schemas/issues.schema.json" } }
```

When a workspace declares no `issues` block and `<path>/.project/issues.json` exists, the adapter is
reported as `project-json` with `resolvedFrom: "convention"` — inferred, and said so. When neither
exists, `provider: null`; never a guess, never an empty list standing in for an absent backend.

**Constraint:** the declaration must NOT be written through `workspace add --replace`, which drops
the `commands` map (`packages/cli/src/workspace-declaration.ts:138-146`) and would destroy rcdc5's
`vpn` and `code-boundaries` entries. That defect is one of the items this spec migrates; until it is
fixed, the `issues` block is declared by a one-time hand edit documented in the plan.

### The surface

Work items graduate out of `refarm project` into their own workspace-scoped, provider-agnostic
command:

```
refarm issues list --workspace refarm --axis node-vs-directory --status open --json
refarm issues list --all-workspaces --json
refarm issues add --workspace refarm --axis cost --location apps/refarm/src/commands/budget.ts:118 ...
refarm issues set-status --workspace refarm --id ISS-042 --status resolved --resolved-by <commit>
refarm issues validate --workspace refarm --json
```

`refarm project` keeps `handoff` and `automations` — genuinely project-local narrative documents.
Work items leave because they are neither project-local nor file-shaped. The **envelope** still
mirrors `automations` exactly: `ok` / `nextCommand` / `nextCommands`, `--json`, `--dry-run` on `add`.

### The `axis` field

`issues.schema.json` sets `additionalProperties: false` and has no axis field. Three options were
considered: reuse `package` (semantically wrong — `cost` is not a package); encode in the id
(`ISS-NODE-001`, a second source of truth embedded in a string that lies when the axis changes); or
add the field. **Adding it wins** — `additionalProperties: false` forces the extension to be
deliberate, which is the right property.

```
axis: "node-vs-directory" | "cost" | "sandbox" | "durability" | "other"
```

**Optional in the schema, required by the gate for `status: open`.** The 22 legacy entries do not
break, no open issue is unclassified, and the two legacy open issues receive `other` rather than an
invented retroactive classification. On remote adapters `axis` is a label; the field is native to the
contract and emulated by the backend.

**`resolved_by` becomes gate-required when moving to `resolved`.** The field already exists. Without
it, "resolved" is an assertion without proof — the exact defect the two prose contradictions exhibit.

### Which document means what

| Document | Meaning | Lifecycle |
| --- | --- | --- |
| work items (any backend) | **Named debt, not yet scheduled.** Every loose end lives here. | `open` → `deferred` → `resolved` |
| `tasks.json` | **Work scheduled inside a plan.** Unchanged by this spec. | an issue becomes a task when a plan adopts it |
| `handoff.json` | **Short narrative that cites qualified ids**, instead of restating prose. | rewritten each slice |

Nothing is discarded. `body` is defined as *"Full detail and context for downstream composition"* —
exactly where each dense paragraph goes, with `location` carrying the file and line every prose loose
end already names. This is relocation; every rationale, rejected alternative and measurement stays
textually in the repository.

### The gate's third state

Two new checks in `scripts/ci/project-block-consistency.mjs`, both with an **external anchor** —
which is precisely what today's checks lack. The gate is workspace-local by nature: it runs inside
one repository and checks that repository's handoff against that repository's work items.

1. **Cross-document integrity, handoff ↔ work items (BLOCKS).** Two directions, both deterministic
   and requiring no prose interpretation:
   - every id cited in `next_actions` or `blockers` exists in this workspace's ledger;
   - every entry in `next_actions` and `blockers` cites **at least one** id.

   The second direction makes the migration load-bearing: a slice that writes a new prose loose end
   without creating its work item breaks the gate. **The reverse rule — every open item must appear
   in the handoff — is deliberately NOT adopted**, because with ~29 open items it would force the
   handoff back into the bloat this spec exists to end. The handoff cites what this slice is about;
   the ledger holds everything.
2. **Freshness anchored in git (WARNS).** If commits landed since the ledger last changed and no item
   changed state, the ledger is possibly stopped. This is the signal that would have fired in June.

### Truncation declares itself

`resume --json` keeps `arrayLimit: 5` as a display default — the agent does not need 54,300
characters at every slice start, so the limit is right. The defect was never truncating; it was
truncating **in silence**. The envelope gains, per field, the total and the returned count:

```json
{ "project": { "nextActions": [...5 items...],
               "truncation": { "nextActions": { "returned": 5, "total": 24 },
                               "currentTasks": { "returned": 5, "total": 24 } } } }
```

with `nextCommands` naming the command that returns the rest. Three states, never two: complete,
truncated-and-said-so, unreadable.

### What the phone asks

`refarm resume --json` gains a `ledger` block, **grouped by workspace, never summed across them**:

```json
{ "ledger": { "workspaces": { "refarm": { "open": 24, "byAxis": { "node-vs-directory": 14, "cost": 5 } },
                              "rcdc5":  { "open": 20, "byAxis": { "other": 20 } } },
              "stale": false, "lastMovement": "2026-08-08" } }
```

The figures are **shape, not measurement** — the real per-axis split is produced by the migration and
checked by the live proof below. `nextCommands` points at the axis with the most open items in the
resolved workspace. This is requirement 1 of `docs/OPERATOR_REQUIREMENTS.md` — *"saber o que demanda
sua atenção e por quê"* — becoming a number instead of prose, answerable from Termux.

## Truth cleanup, by measurement

- **Kill the stale interview blocker** (`OPERATOR_REQUIREMENTS.md` exists since `80df1537`).
- **Resolve the two contradictions by reading the code**, not the prose that disagrees with itself.
  Item (5) and the `workspace sync` rooting each get a measured verdict, and the migrated item
  records which measurement decided it.
- **Migrate blockers and open questions too**, each as a work item with its own category, so "what is
  left" is one number per workspace rather than three lists.

## Error handling

- A malformed ledger fails `validate` with the schema path, never a partial normalisation.
- A workspace whose adapter throws appears in the `unreadable` bucket with its reason. It is never
  omitted and never reported as zero open items.
- The freshness check cannot read git (shallow clone, no `.git`) → reports `unknown`, never `fresh`.
- `set-status --status resolved` without `--resolved-by` refuses before writing.
- `add` with a duplicate id refuses; the CI gate already treats duplicate ids as an error and the
  writer must not be able to create one.
- A cwd matching no declared workspace refuses with the declared list; it never reads `./.project`.
- Writing a field the adapter declares `unsupported` refuses with the capability table, rather than
  writing a record the backend will silently truncate.

## Testing

- **Adapter contract**: one shared test suite run against `project-json` twice — once with refarm's
  schema and fields, once with rcdc5's (`description` present, different id namespace). Same suite,
  two fixtures; a contract that only passes with one of them has failed.
- **Capability degradation**: a fake adapter declaring `location: unsupported` must make `add
  --location` refuse, and `list` must report the field as unsupported rather than null.
- **Workspace scope**: `--workspace` resolving through a declared catalog with cwd set elsewhere;
  cwd-match reporting `resolvedFrom: "cwd-match"`; unmatched cwd refusing with the list.
- **Aggregation**: `--all-workspaces` never merges ids; a failing adapter lands in `unreadable`.
- **Gate**: fixtures per verdict — cited id missing, handoff entry citing nothing, open item with no
  `axis`, resolved with no `resolved_by`, git unreadable → `unknown`.
- **Truncation**: a handoff fixture longer than the limit returns mismatched counts; one exactly at
  the limit must not falsely claim truncation.
- **Live proof**, on the operator's real node: `refarm resume --json` reports `total: 24` for both
  truncated fields; `refarm issues list --all-workspaces --json` returns refarm and rcdc5 as separate
  groups with their own counts and no shared id space; and the same command run from `/tmp`,
  `~/github/refarm` and `~/git/rcdc5/rcdc5` returns identical output.

## What is NOT in this spec

- No fix to any node-vs-directory, cost, sandbox or durability item. They become countable here and
  get fixed in their own slices.
- **No `github` or `gitlab` adapter.** The mapping table above is designed, not built.
- No change to `tasks.json`, `requirements.json`, or their schemas.
- No fix to `refarm project`'s own positional resolution of `handoff.json` — that is a work item this
  spec files, and closing it belongs to the node-vs-directory axis.
- No budget ingestion. That remains an open question, unchanged.
