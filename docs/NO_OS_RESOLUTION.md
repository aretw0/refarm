# No resolver defaults to the OS

## Two instruments, and why one is not enough

This repo runs **two** instruments against the same underlying failure — a
resolver silently reading the OS instead of a declaration. They are not
redundant, and conflating them cost a full plan restart mid-project (see the
worked example below).

- **`scripts/no-os-resolution.mjs`, most of this file, counts by CODE SHAPE.**
  It scans source text for two textual shapes (`= process.cwd()`, `??
  homedir()`, detailed below) and holds a ceiling so a **new** occurrence of
  either shape fails CI. It is fast, dependency-free, and complete by
  construction — a whitelist, not a blacklist, so a third resolving module is
  caught automatically. But it has **no opinion on whether a matched site is a
  bug**. Most matched sites are not: they are commands like `release`, `cert`,
  or `scan` that correctly want wherever the operator is standing right now.
- **`scripts/directory-independence.mjs`, the probe, measures by
  CONSEQUENCE.** It runs real, read-only `--json` commands from several real
  directories and diffs the parsed answers. It has no idea what shape of code
  produced a divergence — it only knows whether the operator got a different,
  undeclared answer depending on where he happened to stand. See "The
  consequence instrument" near the end of this file for what it covers, its
  current table, and why it lives in this file rather than its own document.

**The worked example this repo now carries — the ratchet is not a map of what
hurts.** The first version of `docs/superpowers/plans/2026-08-07-who-owns-this-work.md`
selected its work by shape: it took ten sites out of this ratchet's own scan
whose filenames sounded like attribution and treated that list as the fix
target. An audit — that plan's own Task 1, written as a stop gate for exactly
this possibility — proved:

- `refarm.workspace.id` is decided by `resolveDispatchWorkspace`
  (`apps/refarm/src/commands/ask.ts:820`), which was not one of the ten, and
  whose `process.cwd()` there is deliberate and documented — the interactive
  entry point is the one place a human's current directory should count.
- `host.name` is decided in Rust (`packages/tractor/src/node_identity.rs:174`),
  not TypeScript at all — outside this ratchet's scan scope by construction
  (see "Scope is `apps/*/src` and `packages/*/src` only" below).
- The live defect — the operator's own VPN connection disappearing depending
  on which directory he ran `refarm connection status` from — was in
  `apps/refarm/src/commands/connection.ts:830`, a file that was not on the
  shape-selected list at all.
- **Eight of the original ten sites were correct code.** Converting them would
  have been churn on working behaviour, motivated by nothing but a filename
  that sounded relevant.

The plan was re-aimed before any of the eight were touched. Its second version
built the probe described near the end of this file, which found the real
defect (`connection.ts`) on its first run and flagged none of the eight. A
scan by shape is a count of a pattern; most instances of a pattern are not a
problem, and only running the thing and comparing answers tells you which
ones are.

## The rule

A function that resolves "where does this node's state live" must take that
base **explicitly** — as a required argument, or by reading a declared source
(an env var, an injected config object). It must never *silently* fall back to
wherever the OS says the current process happens to be standing:

```ts
// The footgun — forgetting the argument does not raise an error.
function resolveTlsDir(root: string = process.cwd()): string { ... }
function scopedAssetsDir(options: { userHome?: string } = {}) {
  return options.userHome ?? homedir();
}
```

`process.cwd()` is almost always right while developing inside the repo and
almost always wrong the moment the process is invoked from anywhere else — a
cron job, a daemon, a different working directory, another checkout. The
failure is invisible exactly where it is tested and visible only where it
costs something.

**Two live instances**, both found by running rather than reading
(2026-08-05/07):

- `refarm connection status --json` listed the operator's VPN connection from
  `~/github/refarm` and returned **nothing** from `~/git/rcdc5` or `/tmp`. His
  own connection, invisible from inside his own workspace.
- The sandbox's plugin install wrote the working tree's `agent.wasm` into the
  operator's **real** `~/.refarm/assets/` (confirmed on disk, mtime
  2026-08-07 07:56), because `packages/storage-fs/src/scope.ts:60-63` does
  `options.userHome ?? homedir()` and never consults the declared home. This
  exact site is one of the 119 the ratchet below finds today.

## The two allowlisted modules — a WHITELIST

Exactly two modules are permitted to ask the OS where it is standing:

```
apps/refarm/src/utils/refarm-home.ts
packages/config/src/index.js
```

These are the **center**: 31 files import `refarm-home.ts` and 22 use
`declaredBase`/`sovereignDir` from `packages/config/src/index.js`. Every other
module is expected to go through one of these two, not to ask the OS on its
own.

This is a whitelist, not a blacklist of "known offenders," on purpose: a
blacklist only ever grows by someone remembering to add a new bad site to it.
A whitelist is complete by construction — a **third** module that starts
resolving the OS home is flagged automatically, the first time the ratchet
runs against it, with no one having to notice and add it anywhere.

The match is against a file's **full relative path from the repo root**,
never a basename — `packages/other/src/refarm-home.ts` (same filename,
different package) is **not** allowlisted, and the ratchet's own test pins
that distinction directly.

## Why `= process.env` is correct, and excluded by construction

```ts
function detectPackageManager({ cwd = process.cwd(), env = process.env } = {}) { ... }
```

`env = process.env` is a parameter default too — but reading the *declaration*
of the environment is exactly the right behaviour: a resolver that takes
`env = process.env` and later reads `env.REFARM_HOME` from it is doing what
this rule asks for, not violating it. The scanner never even looks for the
text `process.env` — the two resolver calls it searches for are
`process.cwd()` and every spelling of `homedir()` it can verify (see below).
`= process.env` is excluded **by construction**, not by a second check that
could drift out of sync: there is nothing in the pattern list for it to
accidentally match. There are roughly 92 such sites in this repo today, and
none of them are a target for this plan.

## The ratchet

`scripts/no-os-resolution.mjs` exports `scanForOsResolution(files)` — a PURE
function: it takes `{ path, content }` records and returns the offending
sites, never touching the filesystem itself. `collectScanFiles` is the thin
impure edge that walks `apps/*/src` and `packages/*/src` on a real checkout
and hands the pure function real file contents. `scripts/no-os-resolution.test.mjs`
composes the two (`computeBaseline`) and asserts the count. Run it directly to
see the CLI report without opening a test runner:

```bash
node scripts/no-os-resolution.mjs
# no-os-resolution: 117 offending site(s) across 921 scanned file(s) (default=61, fallback=56)
#   ceiling: 117
#   delta:   0
```

(117 as of 2026-08-08, `connection.ts`'s fix — see the worked example above.
It started at 119; run the command yourself rather than trusting either
number, since the whole point of a ratchet is that it moves.)

Two shapes are matched:

- **`default`** — a bare `=` (never `==`, `!=`, `<=`, `>=`, or `=>`)
  immediately followed by a resolver call. This covers a true function
  parameter default (`function f(root = process.cwd())`), a destructuring
  parameter default (`{ home = homedir() } = {}` — the real shape at
  `packages/farm-client/src/auth.mjs`), **and** a plain, unconditional
  variable assignment (`const x = process.cwd();`). The last of those is not
  "forgettable" the way a parameter default is, but it is still an unguarded
  direct read outside the two allowlisted modules, and it is exactly the
  shape the ratchet's own Step 5 proof (below) adds to confirm the guard
  fires — see `task-1-report.md` for the full reasoning and the measured
  effect of scoping this more narrowly.
- **`fallback`** — `?? <resolverCall>`, anywhere it appears. Unambiguous:
  `??` is always a fallback expression.

A resolver call only counts once its identity is verified against the file's
**own** `"node:os"` import — `homedir()` can be imported and called three
different ways, and the scanner handles each explicitly rather than trusting
bare text:

| Import shape | Example | Handling |
| --- | --- | --- |
| Default/namespace import | `import os from "node:os"` | `os.homedir()` is trusted — matched as a member call on that binding's local name. |
| Destructured, unaliased | `import { homedir } from "node:os"` | a bare `homedir()` call is trusted **only in this file**, because the import was found. |
| Destructured, aliased | `import { homedir as getHome } from "node:os"` | a bare `getHome()` call is trusted, under its **local** name — the scan follows the alias, not the literal word `homedir`. |

A bare `homedir()` call in a file with **no** `"node:os"` import at all is
never flagged — it might be an unrelated local function, and the scanner
would rather undercount than manufacture a false positive that erodes trust
in the whole mechanism.

**Comments and strings never count.** `maskComments` and
`maskStringsAndTemplates` blank out every `//` line comment, `/* */` block
comment, and single/double/backtick string (template literals included,
wholesale — see the doc comment on `maskStringsAndTemplates` for the one
documented gap this creates) before any resolver pattern is matched, so a
commented-out example or a string that happens to mention `process.cwd()`
can never inflate the count. Import-binding discovery runs on a
comments-masked-but-strings-intact pass specifically because the import
specifier `"node:os"` is itself a string literal that has to stay readable.

## Running a burn-down slice

1. Run `node scripts/no-os-resolution.mjs` (or read `sites` from
   `computeBaseline()` directly) to see every current offender, file and
   line.
2. Pick a coherent slice — one command family, not a scattering (see
   `docs/superpowers/plans/2026-08-07-no-resolver-defaults-to-the-os.md`,
   Task 2).
3. For each site in the slice, **audit before changing**: did the caller want
   the node's declared base, or the operator's current directory? Some
   commands (`release`, `cert`, `scan`) legitimately operate where the
   operator is standing — those get an **explicit** resolver call, never
   removed, just no longer a silent default.
4. Lower `BASELINE_MAX_OFFENDING_SITES` in `scripts/no-os-resolution.mjs` by
   exactly the number of sites the slice removed. State the before/after in
   the commit message. **Never raise it** to make a slice pass — a raised
   ceiling defeats the entire mechanism; the fix belongs in the code, not the
   guard.
5. Run `node --test scripts/no-os-resolution.test.mjs` and confirm the
   printed count matches the new ceiling exactly (delta `0`).

## Known limitations

The scanner is a text scanner over masked source, not a full parser — this
keeps it fast, dependency-free, and legible, at the cost of a few documented
gaps:

- **`||`-based fallbacks are not matched** — only `??`. Real, live examples
  exist today (`packages/health/src/auditors/*.js`, e.g.
  `context.rootDir || process.cwd()`), and are not part of this ratchet's
  count. A future slice could extend the pattern set to cover them
  explicitly; doing so silently here would have moved the baseline without
  anyone deciding to.
- **A resolver call reached only through a template literal's `${...}`
  interpolation is invisible** — template literals are masked wholesale, per
  the brief this file was built from ("an occurrence inside a string literal
  or template literal must NOT count"). No such shape exists in this repo
  today (verified 2026-08-07); a real tokenizer would recurse into `${...}`
  and this one does not.
- **A parenthesized assignment expression** (e.g. `while ((x = process.cwd()))`)
  could in principle be misclassified as a parameter default by the
  `default` shape's forward/backward delimiter check — no live example
  exists in this repo, but it is a theoretical false-positive class worth
  knowing about before trusting the scanner blindly on unfamiliar code.
- **Scope is `apps/*/src` and `packages/*/src` only** — `examples/*`,
  `validations/*`, and `templates/*` are out of scope, matching the plan this
  ratchet was built from, not an oversight.

## Wired into CI

`pnpm run no-os-resolution:test` runs `node --test scripts/no-os-resolution.test.mjs`.
It is a step in the `checkers` job of `.github/workflows/test.yml` — the home
for deterministic, UNGATED repo-invariant checks that run on **every**
push/PR regardless of which files changed, specifically so a `--no-verify`
push or a fresh clone cannot bypass it. See `task-1-report.md` for why this
placement was chosen over the alternatives that exist in this repo today.

## The consequence instrument: `scripts/directory-independence.mjs`

This is the second instrument named in "Two instruments" above. It lives in
this file rather than its own document on purpose: it targets the exact same
underlying failure (a resolver reading the OS instead of a declaration) as
the ratchet above, and a reader who learns about only one of the two is in
exactly the position that produced the eight-of-ten miss — a plan that
believes a shape-scan is a map of consequences. Splitting the two into
separate documents would recreate the same split that caused that mistake;
keeping them in one file forces the connection to stay visible. The probe's
own source comment (`scripts/directory-independence.mjs`, top of file) makes
the same argument independently, for the same reason.

### What it measures

`scripts/directory-independence.mjs` runs each of five real, read-only
`--json` commands from three real directories — this repo checkout, the
operator's actual work repository (`~/git/rcdc5`, falling back to `$HOME` if
that path is unavailable), and `/tmp`, a directory with no relationship to
refarm at all — against the **built** CLI (`apps/refarm/dist/index.js`), and
diffs the parsed JSON answers field-path by field-path.

Each probed command **declares** whether its answer must be identical from
every directory (`allowedVaryingFieldPaths: []`) or which specific field
paths may legitimately vary because they are facts about the working tree,
not about the operator (e.g. "which `agent.wasm` did *this* checkout build").
**Declaration is per FIELD PATH, never per command** — a blanket "this
command is exempt" would hide a real defect inside a legitimate one, which is
exactly the failure mode a coarser exemption would reintroduce.

Four verdicts, not two: `same`, `differs-as-declared`, `differs-undeclared`,
and `unrunnable`. The fourth is load-bearing: a command that crashes or times
out in one directory produces no output, and comparing two absent results
would read as agreement (`same`) rather than the "I don't know" it actually
is — `unrunnable` always wins over any comparison, before one is even
attempted.

### The probe's table, measured 2026-08-10

```bash
$ pnpm run directory-independence
```

**37 probed · 30 same · 3 declared · 0 convicted · 0 unproven** (2026-08-10, after the burn-down and
the two instrument fixes that followed; the first run of this table, before any fix, was 35 probed ·
26 same · 1 declared · **4 convicted**). `task list` joined the probe when ISS-091 stopped it
writing on read; `check --next-action`, `health` and `project handoff validate` moved from
`unrunnable-somewhere` to `differs-*` when ISS-098 stopped a non-zero exit being read as "did not
run". The five-command table this section
used to carry covered 8% of a 64-command surface; the gap was never chosen, it was simply never
required of anyone.

| Command | Scope | Verdict | Judgement |
| --- | --- | --- | --- |
| `resume` | node | differs-as-declared | pass — its project block, which now names which workspace answered (ISS-092) |
| `resume --workspace <self>` | node | same | pass — the row that proves `--workspace` decouples the answer from the caller's directory |
| `doctor` | node | differs-as-declared | pass — seven advice fields, each traced to a by-design node-vs-operator comparison (ISS-093, ISS-099) |
| `plugin list` | node | same | pass — bundled provenance anchors on the app's own location (ISS-094) |
| `surface list` | node | same | pass — the catalog is the node's, not whatever `.refarm/` sat beside the caller (ISS-095) |
| `context` | node | differs-as-declared | pass — four working-tree fields, each with a written reason |
| `budget usage` · `inspect` | node | same | pass — time-variant fields excluded by the control pair |
| 24 others | node | same | pass |
| `check --next-action` · `project handoff validate` | project | unrunnable-somewhere | pass — refusing outside their project is correct |
| `health` · `package-manager` | project | differs-undeclared | pass — varying by project is their job |

Run it yourself before trusting this table for anything beyond "the shape of what this instrument
reports" — a snapshot goes stale the moment a command is added or code changes. What does NOT go
stale is `apps/refarm/test/commands/probe-coverage.test.ts`, which fails if a new leaf command is
neither probed nor excluded with a written reason.

#### What is universal here, and what belongs to one node

**The declarations are refarm's. The verdicts are the node's.** "`resume` speaks for the node" is a
statement about this binary and is true on every machine that runs it; "`resume` is convicted" is a
measurement of one node on one date. The two live in the same file and must never be read as the same
kind of claim.

Three consequences, all enforced in code rather than asked for in prose:

- **No workspace id is written literally in the table.** The one entry that needs one uses the
  `SELF_WORKSPACE` placeholder, and `withSelfWorkspace` substitutes whatever id THIS node declares
  for this checkout. On a node that declares it as `meu-projeto`, the row runs as
  `issues list --workspace meu-projeto`. On a node that declares this checkout not at all, the row is
  **dropped and the run says so** — never guessed, because a guessed workspace produces a verdict
  about a workspace nobody named.
- **The second directory is read from the node's catalog**, not from a path that looks right. Until
  2026-08-10 it was the hardcoded `~/git/rcdc5` — which is the *parent* of that declared workspace,
  so the probe ran from one workspace and two directories inside none, and no resolver's cwd-match
  branch was ever exercised against a second workspace.
- **A node with fewer workspaces measures less, and the header says which directories answered.** It
  never silently drops to two and reports the result as if three had agreed.

#### Three things this table says that the old one could not

**A command declares what it speaks about.** `scope: "node"` means the answer must not change with
the directory; `scope: "project"` means it must. The `project` rows pass by *differing* — and a
project-scoped command that answered identically everywhere would be **convicted**, because it would
have stopped reading the project. That inverse check is the same rule `refarm parity` applies to its
`ISOLATING_AXES` table.

**Time-variance is measured, not declared.** A control pair — a second run from the first directory —
separates fields that move on their own from fields that move with the directory. Four invocations
need it: `resume` (`environmentPressure.signals`), `budget usage` (`usage.period.*`), `project handoff
validate` (`ageMs`), `inspect` (`createdAt`). Without it, `resume`'s memory reading sat in the same
list as its sixteen real findings. The exclusion self-expires: when a field stops moving in place,
the control stops reporting it and the comparison picks it back up.

**Declaring is not fixing.** Every `allowedVaryingFieldPaths` entry requires a written reason, and
`declared` is counted apart from `same` in every report. Zero convictions over one reasoned
declaration and zero convictions over forty are different states of the same surface.

### Why this probe is not wired into CI

Measured 2026-08-10 under an empty `REFARM_HOME`, which is what CI has:

| Command | Verdict in a CI-shaped environment | Why |
| --- | --- | --- |
| `workspace list` | `same` | `[]` from every directory — **green by emptiness** |
| `connection status` | `same` | `[]` from every directory — green by emptiness |
| `plugin list` | differs | reads the working tree, so the defect survives an empty node |
| `surface list` | differs | same |

CI would catch two of the four real convictions and report **agreement between two absences** as
`same` for the rest. A step that passes because it measured nothing is the defect this instrument
exists to find, so the probe stays local, against a real node, and the tool prints that caveat on
every run rather than leaving it in a document. ISS-097 keeps the decision revisitable: the day CI
has a seeded node fixture — a declared catalog and a second workspace — the probe becomes meaningful
there.

The CI-side guard is `probe-coverage.test.ts`, which is pure, needs no node, and protects the one
thing CI can protect: that a new command cannot join the CLI without being probed or excluded with a
reason.

### The worked example: a fix that revealed the acceptance test was backwards

`connection status` above used to read `differs-undeclared` — the operator's
own `ovpn-serpro` VPN connection was visible from this repo checkout and
invisible from `~/git/rcdc5` and `/tmp`, because `apps/refarm/src/commands/connection.ts`
resolved its config directory as `deps?.cwd?.() ?? process.cwd()` at two
sites. Fixing that (both sites now resolve `declaredBase()`, matching every
other node-level declaration reader in the file) made the probe go green —
and in doing so **revealed that the acceptance test the plan was written
against was aimed backwards**.

`ovpn-serpro` was never declared on the operator's real node. It lived only
in this repo checkout's own gitignored `.refarm/config.json` — a development
fixture created while building this very connection-status feature without
`REFARM_HOME` set, so the CLI's cwd-based fallback (the bug being fixed) wrote
and read its test declarations there instead of the real sovereign home. The
operator's actual `~/.refarm/config.json` had no `connections` key at all, in
its current state or any of its three historical backups. So "visible from
the repo, invisible everywhere else" was never the feature working — it was
the SYMPTOM, the CLI reading a fixture and presenting it as if it were the
node's catalog. The intermediate state — an honest `connections: []` and
`nextAction: null` from all three directories, once the fix landed and before
the operator's node was updated — was the only state in which the empty node
catalog was *legible*. A defect whose symptom looks like the feature working
is the hardest class to catch, and the only reason this one surfaced is that
the fix was not forced to match the acceptance wording by writing the
operator's data to make it pass — see `task-2-report.md` for the full
investigation, and the queue in `.project/handoff.json` for what changed on
the operator's node afterward, with his explicit authorisation, once the
underlying declaration gap was understood rather than papered over.

### What the probe does NOT cover

- **Only five commands are declared**: `workspace list`, `model current`,
  `plugin status`, `context`, `connection status`. Every other `--json`
  surface in the CLI (`resume`, `parity`, `budget observations`, `plugin
  trust`/`approve`, and more) has not been probed and has no declaration —
  absence from the table is not a claim of correctness, it is a claim of "not
  yet measured."
- **Read-only `--json` surfaces only.** `refarm ask` is explicitly excluded
  (it spends model quota and may signal a process); nothing that writes state
  is a candidate for this probe at all, by design — see the plan's own Global
  Constraints ("Read-only commands only").
- **Not wired into CI.** It requires the built CLI (`apps/refarm/dist/index.js`)
  to already exist, so it cannot run in the fast, source-only "Test & Quality"
  lane. `task-1-report.md` argues it belongs in the fuller Release Health gate,
  after the build step, alongside other dist-dependent checks — it has not
  been added there yet.
- **It measures three directories, not every directory a node could run
  from.** A command could still depend on cwd in a way none of `~/github/refarm`,
  `~/git/rcdc5`, or `/tmp` happens to expose.
