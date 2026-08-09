# The Requirements Record Joins The Ledger

Date: 2026-08-09
Status: proposed
Related: `docs/OPERATOR_REQUIREMENTS.md`, `.project/requirements.json`,
`.project/schemas/requirements.schema.json`, `.project/schemas/issues.schema.json`,
`scripts/ci/project-block-consistency.mjs`, `docs/WORK_ITEM_LEDGER.md`,
2026-08-08 the-ledger-is-alive design (the pattern this extends), ISS-089, ISS-090

## Why this exists

The operator has twelve requirements. They live in Markdown, eleven of them say *Parcial*, and no
instrument in this repository can see any of them. On the other side of the wall sits
`.project/requirements.json` — schema-governed, gate-checked, 100% accepted, and last changed
2,672 commits ago.

So the question he actually wants to ask has no answer:

> *"R7 has N open items, R12 has M, K items serve no requirement at all."*

Today that is an impression. This spec makes it a number.

**This spec fixes no requirement.** It makes the twelve countable, and it links the ledger of named
debt to the record of what the debt is for. Every item below is about the record of the work, not
the work — the same posture as the slice it extends.

## What was measured, not argued

### 1. Two requirement records: one governed and dead, one authoritative and invisible

| | `.project/requirements.json` | `docs/OPERATOR_REQUIREMENTS.md` |
| --- | --- | --- |
| entries | 31 (`REQ-ENV-`, `REQ-RESO-`, `REQ-PIPE-`, `REQ-WORK-`, `REQ-RUNTIME-`, `REQ-CONTRACT-`, `REQ-PLUGIN-`, `REQ-DOC-`, `REQ-GOV-`, `REQ-MIG-`, `REQ-AGENT-`) | 12 (`R1`…`R12`) |
| status | **100% `accepted`** | 11 *Parcial*, 1 *Ausente* |
| last changed | 2026-05-05 (`548c472d`) — **2,672 commits ago** | 2026-08-06 (`80df1537`) |
| machine-readable | yes | no |
| governed by a schema | yes | no |
| governed by the CI gate | yes | no |
| has a CLI writer | **no** | no |
| `traces_to` points at | `T-ENV-*`, `T-PIPE-*`, `T-OPS-*` in `tasks.json`, dead since 2026-05-05 | — |

This is the **third instance** of the pattern the 2026-08-08 slice named: *a schema-governed
`.project` document with no CLI writer stops receiving reality.* `tasks.json` and `issues.json` were
the first two; `issues.json` now has a writer and moved 0 commits ago.

### 2. The gate is green over the dead record, and structurally cannot notice

`scripts/ci/project-block-consistency.mjs` checks requirement id uniqueness, `traces_to` against
task ids and phase numbers, and `depends_on` against requirement ids. All 31 entries pass, today,
on this branch. Every one of those checks is **internal to the documents**.

The external anchor added on 2026-08-08 — `readCommitsSinceLedgerChange` — reads
`git log -1 -- .project/issues.json` and nothing else. **The freshness instrument built precisely to
catch a stopped record watches one of the two stopped records.** `requirements.json` at 2,672
commits is invisible to it by construction.

### 3. Neither direction of the link exists

`issues.schema.json` sets `additionalProperties: false` and models no requirement field, so an item
cannot name what it serves. `project-block-consistency.mjs:192` validates `requirements.traces_to`
against **task ids and phase numbers only**, so a requirement pointing at `ISS-024` would be reported
as a missing ref. Neither direction is expressible.

### 4. The second workspace was measured, and it argues the OPPOSITE way this time

The 2026-08-08 slice designed a three-state per-field capability table because refarm's and rcdc5's
issue documents were **already mutually invalid** — rcdc5 carries `description`, refarm's schema
forbids it. The same measurement, run on the requirements documents:

```
$ diff <(json.tool ~/git/rcdc5/rcdc5/.project/schemas/requirements.schema.json) \
       <(json.tool .project/schemas/requirements.schema.json)
IDENTICAL

$ cat ~/git/rcdc5/rcdc5/.project/requirements.json
{ "requirements": [] }          # present, EMPTY, last touched 2026-04-08
```

Two consequences, both load-bearing:

- **No capability table, no second adapter, no provider abstraction for requirements in this slice.**
  One backend, one byte-identical shape, zero divergence pressure. The issues contract earned its
  three-state capability model from a measurement; requirements have the measurement pointing the
  other way, and inventing the abstraction anyway would be cargo-culting our own last slice.
- **The third state is "catalog present and empty", not "catalog absent".** It exists on the
  operator's real node today. An implementation that answered *"unknown requirement id"* for every
  id in rcdc5 would be accidentally right in refarm and wrong there: the honest answer is *this
  workspace's requirement catalog is empty*, which is a different fact with a different fix.

### 5. The maturity vocabulary does not fit the lifecycle enum, and two entries do not fit either

`requirements.schema.json` has `status: proposed | accepted | deferred | implemented | verified` —
a lifecycle. `OPERATOR_REQUIREMENTS.md` defines a six-state **maturity** vocabulary —
*Provado · Parcial · Projetado · Ausente · Decisão do operador · Desconhecido* — with explicit
definitions, including *"Desconhecido nunca equivale a 'está tudo bem'"*. The two answer different
questions: `accepted` is what the operator decided, `parcial` is what reality measures. Mapping one
onto the other would collapse exactly the distinction the document was written to protect.

Two of the twelve carry qualified states in the prose, and the enum can hold one value:

- **R8** — `**Estado: Parcial/Ausente por provedor.**` Two states in one line.
- **R12** — `**Estado: Ausente como visão integrada.**` A state plus its scope.

### 6. Nothing outside CI reads `requirements.json`

`grep -rn requirements.json` over sources, workflows and docs returns
`scripts/ci/project-block-consistency.mjs` and prose references. No package imports it, no command
reads it, no test fixtures depend on its contents. **The blast radius of the migration is one CI
script.**

## Decisions taken with the operator on 2026-08-09

1. **The requirement field on a work item is OPTIONAL.** Forcing every item to name a requirement
   would manufacture false precision — several open items are pure hygiene with no operator-facing
   requirement behind them. *Unserved* is a real answer.
2. **Mirror the `axis` field exactly**: a field in the schema, a `set-requirement` verb beside
   `set-axis`, and a gate check that the cited id exists.
3. **The gate blocks what is deterministic and warns what is judgement** — the rule settled on
   2026-08-08 (*block only what the agent can fix*), applied again here rather than re-derived.
4. **Never summarise prose when migrating. Relocation, verbatim body.**
5. **`.project/requirements.json` becomes the record; the Markdown becomes the index.** R1–R12 move
   verbatim into the governed document. `docs/OPERATOR_REQUIREMENTS.md` keeps its mission,
   principles, minimum journey, trust gates, cultivation order and the seven operator decisions —
   the framing prose that has no id and no instrument — and its *Resultados exigidos* section
   becomes a table of `id · title · maturity` pointing at the command that prints the full body.
   This is the handoff precedent: prose moved into item bodies, the handoff kept citing ids.
6. **The counting surface is its own command family.** `refarm requirements list | set-maturity |
   validate` answers questions about requirements; `refarm issues set-requirement` and
   `--requirement` own the item side. `set-maturity` exists so the document that just came alive has
   a writer — the single structural reason the other two died.

### Sub-decisions taken by the agent, presented for veto and not vetoed

- **(a) Maturity tokens stay in Portuguese** — `provado · parcial · projetado · ausente ·
  decisao-do-operador · desconhecido`. The table that defines them is the operator's and is written
  in Portuguese; an English enum would be a second vocabulary requiring a mapping nobody maintains.
- **(b) `traces_to` stays empty on R1–R12.** The gate validates it against `tasks.json`, dead since
  2026-05-05. Pointing there would reproduce the defect ISS-089 names. The link runs one way:
  item → requirement.
- **(c) The item's `requirement` field is singular, not a list.** One item serves at most one
  requirement — the one it most directly serves. Multi-valued links make per-requirement counts
  overlap, and *"R7 has N open"* stops being a decidable number. Overlap belongs in the `body`.

## Architecture

### The record

`.project/requirements.json` gains twelve entries, ids `R1`…`R12` — the operator's own vocabulary,
unprefixed. Four new fields in `requirements.schema.json`, **all optional**, so the 31 legacy
entries stay valid without being touched:

| Field | Type | Carries |
| --- | --- | --- |
| `title` | string | The heading text (`"Continuidade operacional"`) — needed by the index table and the text render |
| `maturity` | enum, 6 states | The operator's vocabulary, verbatim tokens |
| `maturity_note` | string | The justification paragraph that follows `**Estado: X.**`, verbatim |
| `evidence` | string[] | The document links under **Evidência**, verbatim |

Existing fields are populated by relocation, not composition:

```json
{
  "id": "R7",
  "title": "Operação por dispositivos e superfícies leves",
  "description": "<the Necessidade paragraph, verbatim>",
  "type": "functional",
  "status": "accepted",
  "priority": "must",
  "acceptance_criteria": ["<each bullet, verbatim>"],
  "source": "human",
  "maturity": "parcial",
  "maturity_note": "<the paragraph after **Estado:**, verbatim>",
  "evidence": []
}
```

- **`status` is `accepted` for all twelve** — the operator accepted them at the 2026-08-06 interview.
  `maturity` is what reality measures. Both are kept; neither is derived from the other.
- **`priority` is `must` for all twelve.** The section is titled *Resultados exigidos*; inventing a
  MoSCoW ranking the operator never gave would be a second, quieter requirements document. The
  ordering he *did* give lives in *Ordem de cultivo derivada dos requisitos* and stays in the
  Markdown.
- **`source: "human"`** — the 2026-08-06 interview. The May cohort keeps `source: "analysis"`, which
  is how the two cohorts stay distinguishable without inventing a `cohort` field.
- **`type`** is assigned per requirement (R8 `integration`, R10 `constraint`, R11 `non-functional`,
  the rest `functional`) and the assignment table lives in the plan, so a wrong call is visible and
  correctable rather than buried in a migration script.
- **R8 takes `parcial`** — the state of the family — with `"Parcial/Ausente por provedor."` verbatim
  at the head of its `maturity_note`. **R12 takes `ausente`**, with `"Ausente como visão integrada."`
  verbatim. In both cases the enum is a floor and the note is authoritative.

The Markdown's *Resultados exigidos* section becomes:

| Id | Resultado | Maturidade |
| --- | --- | --- |
| R1 | Continuidade operacional | parcial |
| … | … | … |

followed by the command that prints any body in full. Nothing is shortened; the prose is one file to
the left.

### The link

`requirement?: string` joins the neutral work-item contract — `WORK_ITEM_FIELDS`, the `WorkItem`
interface, the capability table (`project-json`: `native`; `github`/`gitlab`, mapped and not built:
`emulated` via a `req:R7` label) and `issues.schema.json`, whose `additionalProperties: false` makes
the extension deliberate, which is the property that made it the right answer for `axis`.

The adapter writes it through the same key-order-preserving rebuild `axis` uses, generalised:
`withAxis` becomes `withField(record, key, value, anchors)`, inserting after the first anchor
present — `["axis", "package"]` for `requirement` — and appending only when no anchor exists. The
existing behaviour (every unmodelled key survives, including rcdc5's `description`; a
classified-later item is byte-shaped like a classified-at-add one) is preserved by construction and
pinned by the tests that already exist for `axis`.

### The verbs

```bash
refarm issues set-requirement --workspace refarm --id ISS-024 --requirement R2 --json
refarm issues set-requirement --workspace refarm --id ISS-024 --clear --json
refarm issues list --workspace refarm --requirement R7 --json
refarm issues list --workspace refarm --unserved --json

refarm requirements list --workspace refarm --json
refarm requirements set-maturity --workspace refarm --id R7 --maturity provado --evidence <ref> --json
refarm requirements validate --workspace refarm --json
```

**`set-requirement` validates against the catalog before any write.** An axis is a closed enum in
code; a requirement id is *data*, so the CLI must read the catalog to refuse a typo at the point of
the write. This is the eighth-instance rule applied to a value that cannot be validated by an enum:
`--requirement R70` must refuse, never write a citation that reads as truth until CI notices.

**`--clear` exists because `set-axis` has no counterpart and needs none.** An open item is required
by the gate to carry an axis, so there is nothing to clear it to. A requirement link is optional, and
a *wrong* link manufactures a false count in the exact number this slice exists to produce — the
writer must be able to undo it.

**`--unserved` is a flag, not `--requirement none`.** A sentinel value would reserve a string that a
real requirement id could take.

**`set-maturity --maturity provado` refuses without `--evidence`.** Same precedent as `--status
resolved` refusing without `--resolved-by`, and it is literally rule 6 of the operator's own protocol:
*"não elevar um requisito a Provado sem evidência executada"*. `--evidence` appends to the array,
deduplicated — evidence accumulates, it does not replace.

### The counting surface

`refarm requirements list` reads **two** documents and reports both provenances:

```json
{
  "workspaceId": "refarm",
  "workspaceFrom": "flag" | "cwd-match",
  "provider": "project-json",
  "providerFrom": "declared" | "convention",
  "catalog": { "total": 43, "withMaturity": 12, "empty": false },
  "requirements": [
    { "id": "R7", "title": "…", "maturity": "parcial", "status": "accepted",
      "counts": { "open": 9, "deferred": 0, "resolved": 1 } }
  ],
  "unserved": { "open": 31, "deferred": 0, "resolved": 12 },
  "ledger": { "readable": true, "reason": null }
}
```

**The figures above are shape, not measurement.** The real per-requirement split is produced by the
classification pass at the end of this slice and recorded where it can be re-taken by running the
command — never asserted in advance in a document.

**When the ledger cannot be read, every `counts` and `unserved` value is `null` and `ledger.readable`
is `false` with a named reason.** Zeros would be a lie of exactly the shape this line of work has
now catalogued nine times: a count that means *nothing left* and a count that means *nothing read*
must never be the same value.

**When the catalog is empty** — rcdc5, today — `requirements: []`, `catalog.empty: true`, and
`unserved` still counts that workspace's items. A workspace with 20 open items and no requirements is
a legible state, not an error.

The text render prints `id · title · maturity · open`, sorted by open count descending, plus the
unserved line. `title` is a heading and fits; the **paragraph** fields are deliberately absent,
because truncating a paragraph for a terminal would require declaring the truncation, and the honest
cheap answer is not to truncate at all — `--json` carries every field.

`--all-workspaces` is **not** built for requirements this slice, and is filed as a work item rather
than left to be discovered.

### Where the catalog is declared

Same two-state resolution the ledger uses: a workspace **may** declare
`"requirements": { "provider": "project-json", "path": ".project/requirements.json" }` in the node
catalog, and otherwise `<path>/.project/requirements.json` is found by convention and **reported as
`providerFrom: "convention"`** — inferred, and said so.

Refarm's own entry will **not** be edited to declare it. The `issues` block was declared by a
one-time hand edit last slice; repeating that would mean another hand write to
`~/.refarm/config.json`, outside this repository, to gain nothing the convention path does not
already give correctly. `workspace add --replace` still drops the `commands` map (ISS-036), so a
scripted edit is not available either. The declared path is supported and tested with injected IO;
the live node exercises the convention path. That asymmetry is recorded here so it reads as a
decision rather than an omission.

### The gate

Two additions to `scripts/ci/project-block-consistency.mjs`, both pure and exported so they are
testable without a filesystem — the split the file already follows:

1. **`checkRequirementCitations(requirements, issues)` — BLOCKS.** Every `requirement` on an item
   must exist in `requirements.json`. Deterministic, and the agent fixes it with one command
   (`set-requirement`, or `--clear`), which is the standing rule for what may block.
2. **`checkProvedWithOpenWork(requirements, issues)` — WARNS.** A requirement whose `maturity` is
   `provado` with open items citing it is a contradiction worth surfacing — and a judgement, because
   an open item can legitimately sit beyond a proof that already landed.

**No freshness warning is added for `requirements.json`, deliberately.** A requirements record is not
a queue; it legitimately sits still for hundreds of commits. A warning that fires on every run trains
its reader to ignore warnings, which would cost more than the signal is worth. The staleness that
motivated this spec is fixed by giving the document a writer and a reason to be written, not by an
alarm nobody can silence.

**`issues validate` gains an `unknown_requirement` finding** so the agent can pre-check what the gate
blocks, with a runnable `nextCommand` naming the first offending id. `requirements validate` keeps
the catalog-internal rules: duplicate ids, `provado` with no evidence, unknown maturity token.

### The entry point

`refarm resume --json`'s ledger handoff appends `refarm requirements list --workspace <top> --json`
for the workspace it already selected. No new IO in `resume`: it is one string in `nextCommands`. If
that workspace's catalog is empty, the command answers *empty catalog* — which is the true state and
points at the real gap.

### The measurement

The slice ends with a classification pass over the 60 open items, **performed through
`set-requirement`** rather than by hand — which proves the writer on the way to producing the number.
An item is linked only when its body names an outcome the requirement's acceptance criteria already
cover; everything else stays unserved, because that is the correct answer for hygiene. The judgement
calls that sat closest to the line are reported by name, not averaged into the total.

## Error handling

- `set-requirement --requirement <unknown>` → refuses, naming the id and listing the catalog's ids.
- `set-requirement` in a workspace whose catalog is **empty** → refuses with `empty_catalog`, a
  different reason from `unknown_requirement`, because the fix is different.
- `set-requirement` in a workspace with **no** catalog → refuses with `no_requirement_catalog`.
- An unreadable or malformed catalog → refuses with `catalog_unreadable`; never an empty list.
- `set-requirement --requirement X --clear` together → refuses; exactly one intent per write.
- `issues list --requirement <unknown>` → refuses before resolving anything, like `--axis`.
- `issues list --requirement X --unserved` together → refuses; they are opposite questions, and
  letting one win invisibly is the `--workspace`/`--all-workspaces` defect (Finding 4) again.
- `requirements set-maturity --maturity provado` with no `--evidence` → refuses before writing.
- `requirements set-maturity --id <unknown>` → refuses, listing the ids.
- `requirements list` with an unreadable ledger → `counts: null`, `ledger.readable: false`, a named
  reason, and exit 0: the catalog *was* read, and saying so is not a failure.
- A requirement id that exists in the catalog but whose entry is malformed → surfaced by
  `requirements validate` as a finding, never silently skipped in the counts.

## Testing

- **Schema**: the 31 legacy entries validate unchanged against the extended schema; an entry with an
  unknown maturity token fails.
- **Migration**: the extracted `description`, `acceptance_criteria`, `maturity_note` and `evidence`
  strings are asserted **byte-identical** to the Markdown source they came from — the same
  verbatim-relocation proof the ledger migration used, run as a test rather than a review.
- **Adapter**: `withField` preserves key order and unmodelled keys (rcdc5's `description`) for both
  `axis` and `requirement`; an item classified later is byte-shaped like one classified at `add`.
- **Catalog resolution**: declared, convention, empty, absent and unreadable — five states, each with
  its own assertion, all through injected IO.
- **Counting**: a fake ledger with known links produces known per-requirement counts and a known
  unserved bucket; an unreadable ledger produces `null`s and never zeros.
- **Gate**: fixtures per verdict — an item citing a missing requirement (blocks), a `provado`
  requirement with an open item (warns), a clean pair (silent).
- **Live proof**, on the operator's real node:
  - `refarm requirements list --workspace refarm --json` identical from `~/github/refarm`, `/tmp` and
    `~/git/rcdc5/rcdc5`;
  - `refarm requirements list --workspace rcdc5 --json` reports an **empty catalog** with its 20 open
    items counted as unserved — the third state, on real data;
  - the gate **bites**: an item hand-edited to cite `R99` exits 1, reverting exits 0. The hand edit is
    the point — the CLI refuses to create that citation, so CLI and gate are proven to be independent
    doors;
  - `refarm requirements set-maturity --id R1 --maturity provado` without `--evidence` refuses;
  - `scripts/no-os-resolution.mjs` reports 117, delta 0.

## What is NOT in this spec

- **No requirement changes state.** Nothing is promoted to `provado` here; the writer exists, the
  promotions belong to the slices that earn them.
- **No `refarm requirements add`.** The twelve exist; a thirteenth comes out of an operator
  interview, not a slice. Filed as a work item.
- **No `--all-workspaces` for requirements**, and no reverse link stored on the requirement — the
  requirement→items direction is derived at read time, never written, so it cannot drift.
- **No capability table and no second adapter for requirements** — see measurement 4. If a second
  backend ever appears, the contract earns its abstraction then, from the same kind of measurement.
- **No change to the 31 legacy entries**, their statuses or their dead `traces_to`. They are the
  historical record of the May cohort; rewriting them would be inventing history to make a table
  tidy.
- **No fix to any axis item.** They become attributable here and get fixed in their own slices.
