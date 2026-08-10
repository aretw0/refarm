# Which Command Answers For The Node

Date: 2026-08-09
Status: proposed
Related: `scripts/directory-independence.mjs`, `scripts/no-os-resolution.mjs`,
`docs/NO_OS_RESOLUTION.md`, `apps/refarm/src/commands/parity.ts` (the inverse-check precedent),
2026-08-07 who-owns-this-work plan, 2026-08-06 two-halves-one-node plan,
ISS-023, ISS-024, ISS-026, ISS-027, ISS-028, ISS-050, ISS-054, ISS-062

## Why this exists

The operator wants to run refarm daily and asked to end the confusion between node, workspace and
sandbox — with granularity. The confusion has a precise shape: **for 59 of 64 commands, nobody knows
whether the answer depends on which directory you are standing in.** Not *knows it is broken* —
does not know.

This spec does not fix the node-vs-directory axis by picking sites off a list. It builds the
instrument that convicts, runs it across the whole read-only surface, and then burns down **only what
it convicts**. The operator chose the exit criterion on 2026-08-09: the slice ends when there are
zero unexplained divergences left across the measured surface.

## What was measured, not argued

### 1. The consequence instrument covers 8% of the command surface

```
$ refarm --help | grep -cE '^  [a-z]'          # top-level commands
64
$ node scripts/directory-independence.mjs      # PROBE_COMMANDS.length
5
```

| Probed today | Verdict, 2026-08-09 |
| --- | --- |
| `workspace list` | same |
| `model current` | same |
| `plugin status` | same |
| `context` | differs-as-declared (4 declared field paths) |
| `connection status` | same |

**The five it covers are clean.** The defect is not in those commands; it is that the other 59 have
no verdict at all, and an uncovered command and a passing command have been read as the same thing.

### 2. Thirty-six read-only invocations are probeable today, without writing any new command

Measured by running each candidate from the repository and requiring exit 0 with parseable JSON on
stdout:

```
PROBEABLE (36): resume · check --next-action · status · health · doctor · context ·
  model current · model providers · plugin status · plugin list · workspace list ·
  connection status · budget observations · budget by-workspace · budget by-host ·
  budget by-spawner · budget usage · sessions list · task list · issues list --workspace refarm ·
  capabilities · agent · runtime status · project handoff validate · process list ·
  delivery list · records list · vault list · skill list · extension list · theme list ·
  tree list · inspect · surface list · actions · package-manager
```

Not probeable, by category and each for a stated reason — not one of them a silent omission:

| Reason | Invocations |
| --- | --- |
| Needs an argument this probe has no fixture for | `config profile <name>`, `source status <ref>`, `tree show <id>`, `tasks show <id>` |
| Needs the sandbox node running | `parity` |
| Has no read-only JSON reader at all | `telemetry`, `intention check`, `dispatch`, `session`, `discover` |
| Mutating — excluded by rule, never by accident | everything else |

**5 → 36 is a 7.2× coverage increase with no new command and no new flag.**

### 3. The daily loop runs through the unmeasured sites

103 `process.cwd()` sites across 30 source files (`apps/refarm/src` + `packages/*/src`; the ratchet
counts 117 with its two shapes over 926 files, scripts included):

| Sites | File |
| --- | --- |
| 10 | `packages/config/src/package-manager.js` |
| 7 | `apps/refarm/src/commands/process.ts` |
| 5 | `apps/refarm/src/commands/cert.ts` |
| 4 | `apps/refarm/src/commands/release.ts` |
| 3 each | `resume.ts`, `doctor.ts`, `health.ts`, `delivery.ts`, `surface.ts`, `project-automations.ts`, `process-handoff` |

`resume`, `doctor` and `health` are the three commands `CLAUDE.md` §4 mandates at the start of every
slice. **The operator's daily loop passes through the defect's own territory**, and has no verdict.

### 4. Selecting sites by shape is measurably wrong

Recorded in the handoff for the 2026-08-07 slice, and the reason ISS-024 forbids a reflex
substitution in its own body: a first attempt picked ten sites by how they looked, and its own stop
gate proved **eight of the ten wanted the operator's cwd correctly**, while the live defect — the VPN
visible only from the repository — **was not on the list at all**. The probe built afterwards found
the real one on its first run and flagged none of the eight.

The conclusion this spec inherits rather than re-derives: **shape stops new defects; only consequence
finds the ones that hurt.** The burn-down is driven by the probe's convictions, never by the site
count.

### 5. The probe cannot express a command that is project-local on purpose

```
$ refarm project handoff validate --json      # from ~/github/refarm → ok
$ (cd /tmp && refarm project handoff validate --json)   # → ENOENT /tmp/.project/handoff.json
```

That is correct behaviour: `refarm project` reads *this project's* documents. The probe today
declares varying **fields** (`allowedVaryingFieldPaths`) and has no way to say a command varies
*by design at the command level*. Expanded as-is, it would convict correct commands, and an
instrument that cries wolf is an instrument nobody runs.

### 6. The chosen exit criterion is reachable by declaration, not only by fixing

`allowedVaryingFieldPaths` requires **no reason** today. `differs-undeclared == 0` can therefore be
reached by declaring every divergence rather than closing any of it — and the resulting green would
be indistinguishable from a fixed surface. The criterion the operator chose needs a guard the
instrument does not currently have.

## Decisions taken with the operator on 2026-08-09

1. **P1 first**, chosen from a four-way split of the 32 open items across node-vs-directory, sandbox
   and cost — because the confusion itself is the daily pain.
2. **Measure the whole read-only surface, then fix everything convicted.** The slice ends at zero
   convictions, and the size of the burn-down is accepted as unknown at planning time.
3. **The probe is the acceptance test.** A site no command convicts is not touched.

## Architecture

### A command declares what it speaks about

`PROBE_COMMANDS` entries gain a `scope`, and this is the deliverable the operator actually asked for
— the node/directory boundary as executable declaration rather than prose:

```javascript
{
  name: "resume",
  argv: ["resume", "--json"],
  scope: "node",
  scopeReason: "The slice entry point reports the NODE's runtime, model route and ledger.",
  allowedVaryingFieldPaths: [],
}
{
  name: "project handoff validate",
  argv: ["project", "handoff", "validate", "--json"],
  scope: "project",
  scopeReason: "Reads THIS project's .project/handoff.json; refusing outside a project is correct.",
  allowedVaryingFieldPaths: [],
}
```

| `scope` | Passing means | Convicted when |
| --- | --- | --- |
| `node` | byte-identical from all three directories, modulo declared field paths | any undeclared field differs, **or** it runs in one directory and fails in another |
| `project` | it **differs or refuses** outside its own project | it returns the *same* answer from every directory |

**The `project` row is an inverse check, and it is the one that catches the quiet defect**: a
project-scoped command that stopped differing has stopped reading the project and is answering from
the node. This is not a new idea in this repository — `refarm parity` already crosses a static
`ISOLATING_AXES` table against the observed verdict so that an axis which *stopped* diverging reports
`UNHEALTHY` rather than silently passing. Same rule, applied to directories.

### Three numbers, never one

Every declaration carries a written reason, and the report counts the declarations:

```
directory-independence: 36 probed · 29 same · 5 declared · 2 convicted · 0 unproven
```

**Those figures are the shape of the line, not a prediction.** The real split is produced by the
first full run in the plan's Task 3, and the burn-down is sized from it — this document must not
assert a number it has not taken.

`declared` is not folded into `same`. Zero convictions with five reasoned declarations is a legible
result; zero convictions with forty is a different one, and the operator can see which he has. The
schema enforces it: an entry with `allowedVaryingFieldPaths` and no `fieldReasons` entry for each
path **fails the probe's own unit test**, so the escape hatch cannot be taken silently.

### The verdict observes; the scope judges

The existing four verdicts describe **what was observed**. They gain one — `unproven` — and stop
carrying the judgement, which moves into a matrix crossed with `scope`. Keeping observation and
judgement in one field is what forced the current probe to treat every difference as a defect:

| Verdict (observation) | Meaning |
| --- | --- |
| `same` | identical output from all three directories |
| `differs-as-declared` | every diverging field path is declared **with a reason** |
| `differs-undeclared` | some diverging field path is not declared |
| `unrunnable-somewhere` | runs in at least one directory, fails in at least one other |
| `unproven` | fails in **all** directories (no daemon, no sandbox, missing fixture) |

| | `scope: node` | `scope: project` |
| --- | --- | --- |
| `same` | **pass** | **CONVICTED** — it stopped reading the project |
| `differs-as-declared` | pass, counted apart | pass |
| `differs-undeclared` | **CONVICTED** | pass — a project command is expected to vary |
| `unrunnable-somewhere` | **CONVICTED** — the ENOENT shape | pass — refusing outside its project is correct |
| `unproven` | neither, reported with its cause | neither, reported with its cause |

The split between `unrunnable-somewhere` and `unproven` is the whole point: failing *somewhere* is
the defect, failing *everywhere* is the environment. Collapsing them would let a missing daemon read
as a directory leak — and, in the direction that actually costs something, would let a real
ENOENT-from-`/tmp` hide inside an environmental excuse.

### The control pair: time-variance is not directory-variance

*Added 2026-08-10, after measuring rather than assuming — the first draft of this spec did not have
it, and the burn-down would have started by convicting four correct commands.*

Two runs of the same command **in the same directory** disagree for four of the 36 probeable
invocations:

| Invocation | Field that moves on its own |
| --- | --- |
| `resume` | `environmentPressure.signals` (a live memory and free-space reading) |
| `budget usage` | `usage.period.startMs`, `usage.period.endMs` (a window computed from now) |
| `project handoff validate` | `ageMs` |
| `inspect` | `createdAt` |

The probe spawns each command once per directory, so those fields diverge for reasons that have
nothing to do with directories. Declaring them by hand would work once and then rot: a hand-written
`allowedVaryingFieldPaths` entry outlives its reason and silently covers a real divergence that
appears in the same field later.

So the probe **measures it**: one extra run from the first directory forms a control pair, and any
field that differs between those two is time-variant. Such a field is **unmeasurable by this
instrument** — a third state, neither `same` nor convicted — excluded per FIELD (never per command)
and printed on every row, including `same` rows, so a verdict reached by exclusion always shows what
it excluded. The exclusion is self-expiring: when the field stops moving in place, the control stops
reporting it and the comparison picks it back up.

Proven on real data 2026-08-10: with the control, `resume` reports `environmentPressure.signals` as
time-variant and is convicted on its sixteen `project.*` fields alone. Without it, the memory reading
sat in the same list as the real finding.

### The read-only rule is observed, not promised

`refarm task list --json` **writes** `~/.refarm/sessions/task-session.v1.json` on every read — it
updates `updatedAt` and stamps `lastCommand: "list"`. Measured 2026-08-10 by bisecting a sweep of 72
read-only invocations that changed exactly one file on the operator's node.

Two consequences, and the first is the urgent one:

1. **A mutating command in `PROBE_COMMANDS` runs three times per probe invocation, against the
   operator's real node, forever.** `task list` is therefore excluded with that reason until it
   stops writing, and the write itself is filed as a work item rather than absorbed as a quirk.
2. The plan's "read-only" rule was a promise kept by discipline. `task list` looks read-only from
   every angle that matters — it is called `list`, it prints, it exits 0 — which is exactly why the
   rule needed an observation behind it. The probe therefore compares the node's own file listing
   before and after a full run and **warns**, naming the files that changed. It warns rather than
   blocks because the daemon shares that directory and may legitimately write while the probe runs;
   a blocking check there would fire on the environment and train its reader to ignore it.

### The coverage stops rotting

The reason the probe covers 5 of 64 is that nothing ever required otherwise. A vitest test in
`apps/refarm` walks the Commander tree exported by `program.ts` and asserts that **every leaf command
appears either in `PROBE_COMMANDS` or in an exclusions list with a written reason**. A new command
with neither fails the test.

Without this, the slice buys 36 today and drifts back toward 5 as commands are added — which is
exactly how the current state was reached, with nobody choosing it.

### What CI runs, and what it may claim

*Superseded 2026-08-10 by measurement. The first draft said CI would run a subset and report its
coverage as a fraction. It was wrong about what that subset would be worth.*

Under an empty `REFARM_HOME` — which is what CI has — the probe was run against four commands:

| Command | Verdict in a CI-shaped environment | Why |
| --- | --- | --- |
| `workspace list` | `same` | `[]` from every directory — **green by emptiness** |
| `connection status` | `same` | `[]` from every directory — green by emptiness |
| `plugin list` | differs | reads the working tree, so the defect survives an empty node |
| `surface list` | differs | same |

CI would therefore catch two of the four real convictions and report **agreement between two
absences** as `same` for the rest. A step that passes because it measured nothing is the exact defect
this slice exists to end, so:

- **The probe is a local instrument against a real node, and is deliberately not wired into CI.**
  Filed as ISS-097 so the decision is revisitable: the day CI has a seeded node fixture (a declared
  catalog and a second workspace), the probe becomes meaningful there.
- **The CI-side guard is the coverage test**, `apps/refarm/test/commands/probe-coverage.test.ts`. It
  is pure, needs no node, and it guards the thing CI can actually protect: that a new command cannot
  join the CLI without being probed or excluded with a reason.
- The full local run is the authority, and `docs/NO_OS_RESOLUTION.md` carries the current table with
  the date it was taken.
- **The tool prints the caveat itself**, on every run, because the summary line is the part people
  quote: *"A verdict is only as strong as the node it was taken on: a node with an empty catalog
  answers emptily from every directory, and that reads as `same`."*

### The burn-down

Driven by convictions, one atomic commit each:

1. Run the probe. Every conviction gets a work item with the verdict and the diverging field paths in
   its body — the record exists before the fix, so a fix that is abandoned leaves a named item rather
   than nothing.
2. For each conviction, in the order the daily loop uses the command: read the call site, decide
   whether it wanted the **node** (fix it to `declaredBase()`) or the **directory** (declare the
   scope and, where the answer legitimately varies, the field paths with a reason).
3. The acceptance test for each fix is the probe: that command moves `convicted → same` (or
   `→ differs-as-scoped`), and the commit records the before/after verdict.
4. The ratchet moves with it: when a fix removes an offending site, `BASELINE_MAX_OFFENDING_SITES`
   drops in the same commit, delta 0 — the discipline commit `d8f850b8` already established.

**Exit criterion:** `convicted == 0` across the probed surface, every `declared` carrying a reason,
and every `unproven` carrying its cause.

## Error handling

- A command that times out from one directory and answers from another is `unrunnable` → convicted,
  never `unproven`.
- A command whose JSON contains a timestamp, pid or duration diverges on every run everywhere; those
  field paths are declared with the reason `non-deterministic`, and the declaration is counted like
  any other rather than hidden in a filter.
- `~/git/rcdc5` missing → the probe substitutes the operator's home as the third directory and
  **says so in the report header**, as it already does today. It never drops to two directories
  silently, because the multi-directory property is the whole measurement.
- The CLI not built → every command is `unproven` with `CLI not built`, and the run exits non-zero
  rather than reporting a clean surface it never measured.
- A `PROBE_COMMANDS` entry whose `scope` is missing fails the probe's unit test. There is no default
  scope: guessing whether a command speaks for the node is the confusion this slice exists to end.

## Testing

- **Pure verdict function**: one test per verdict, including both convicting ones — a `node` command
  that differs undeclared, and a `project` command that does *not* differ.
- **Reason enforcement**: a declaration without a reason fails; with one, passes.
- **`unrunnable` vs `unproven`**: failing in one directory convicts; failing in all three reports
  `unproven` and does not convict.
- **Coverage test**: a fake Commander tree with a command in neither list fails; adding it to the
  exclusions with a reason passes.
- **Live**: the full probe from the operator's node, with the resulting table recorded in
  `docs/NO_OS_RESOLUTION.md` and its date; then, per conviction, the before/after verdict in the
  fixing commit.

## What is NOT in this spec

- **No new `--json` reader** for the five commands that have none (`telemetry`, `intention check`,
  `dispatch`, `session`, `discover`). They are named as work items with the measurement attached.
- **No fixture-driven probing** of the four commands needing an id or ref. Named, not built.
- **No cost, sandbox or durability item is fixed here** — except where the probe convicts a command
  that happens to carry one, in which case the fix belongs to this slice and the item is closed with
  the probe's verdict as its `resolved_by` evidence.
- **No change to `refarm parity`**, whose inverse-check idea this borrows.
- **The ratchet's remaining sites are not burned down by count.** Any site no command convicts stays,
  and `scripts/no-os-resolution.mjs` keeps guarding it against becoming a *new* default.
