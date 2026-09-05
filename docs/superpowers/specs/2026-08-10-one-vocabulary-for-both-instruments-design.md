# One vocabulary for both instruments

**Date:** 2026-08-10
**Closes:** ISS-054 (the burn-down that never started), and turns ISS-024 / ISS-102 /
ISS-028 from "somewhere in 111 sites" into named work.
**Serves:** R2 (a command answers for the node it was declared for, not for the directory
it was typed in).

## The finding

`scripts/no-os-resolution.mjs` reports **111 offending sites**. That number has been carried
forward, quoted in three documents and one plan, and lowered exactly twice — both times as a
side effect of a fix aimed at something else.

The burn-down has not started. ISS-054 records that as a scheduling fact. It is not. It is a
property of the instrument:

**The ratchet judges SHAPE. The defect is PURPOSE.**

`?? process.cwd()` is the shape. Whether it is a defect depends on the question the site is
answering:

- *"which project am I in?"* → reading the current directory **is the correct answer**.
- *"where does this node's state live?"* → reading the current directory **is the defect**.

Two live sites, both counted identically today:

```ts
// apps/refarm/src/commands/agent-finish-plan.ts:187 — CORRECT
function findWorkspaceRoot(cwd = process.cwd()): string {   // walks up for the git root
```

```ts
// apps/refarm/src/commands/doctor.ts:401 — CORRECT, and it says so in five lines of prose
// "This value must stay the operator's literal standing directory, so the fallback is a
//  bare `process.cwd()`, not a 'smart' resolver."
const operatorBase = path.resolve(deps?.cwd?.() ?? process.cwd());
```

A site that carries a written argument for why it is right is counted as an offense beside a
site that is simply wrong. So the ceiling can only fall by accident, and every burn-down slice
must re-derive the same judgements from scratch — which `docs/NO_OS_RESOLUTION.md` itself
instructs ("**audit before changing**: did the caller want the node's declared base, or the
operator's current directory?") without giving the audit anywhere to be recorded.

The pressure this creates is real and already visible. `composition-resolver.ts` moved a
legitimate `os.homedir()` into a named function `cohabitationHome()` **specifically so the
scanner would stop counting it**, and documented that it was doing so. That is the instrument
teaching the codebase to hide from it rather than to answer it.

## The unification

The repo already has the right vocabulary — in the *other* instrument.

`scripts/directory-independence.mjs` judges by **scope**:

```js
judge(verdict, scope)   // scope: "node" | "project"
```

…and it has an inverse check, because for a **project**-scoped command, answering identically
from every directory is the conviction. The consequence probe already knows that reading the
directory is sometimes the correct behaviour. The shape ratchet does not.

**Both instruments measure the same property. Only one of them has the words for it.**

So: give the ratchet the probe's vocabulary. A site declares which question it answers; the
ratchet counts by purpose instead of by shape.

## The declaration lives at the site, not in a side table

An exclusions table keyed by `file:line` (the shape `directory-independence-exclusions.mjs`
uses for whole commands) is wrong here, because a line number is not a stable key for 111
sites across a moving codebase. Instead the declaration is a marker comment on the site's own
line or the line above:

```ts
// os-resolution: project — walks up from where the operator stands to find the git root
function findWorkspaceRoot(cwd = process.cwd()): string {
```

Three properties this buys, none of which a side table has:

1. **It cannot drift.** The declaration moves with the code it describes.
2. **The reason is where the next reader is.** Two of the sites already have their reason
   written in prose; this only makes that prose machine-readable.
3. **New sites are unclassified by default**, so the ceiling catches them — a side table would
   need a second mechanism to notice a key it had never seen.

## The four purposes

| Purpose | Question the site answers | Verdict |
| --- | --- | --- |
| `project` | *"which project/repo am I in?"* | **legitimate** — the directory IS the question |
| `process` | *"what cwd do I hand this child process / this path the operator typed?"* | **legitimate** |
| `os-user` | *"where is the OS account's own home?"* (`~/.ssh`, tier co-habitation) | **legitimate, rare** — must name why the refarm base is wrong here |
| `node` | *"where does THIS NODE's state live?"* | **DEFECT** — must resolve from `declaredBase()` |

`project` and `process` map onto the probe's `scope: "project"`; `node` maps onto
`scope: "node"`. `os-user` has no probe equivalent because no command should be scoped to the
OS account — which is exactly why declaring one requires a reason.

## What the ratchet reports after this

Three counters, two of them ratcheted:

```
no-os-resolution: 111 site(s) across 927 file(s)
  unclassified: 111   ceiling 111   delta 0      <- must fall to 0
  defect (node): 0    ceiling 0                  <- must stay 0
  declared-legitimate: 0                         <- uncapped; a documented answer, not debt
```

The single number becomes a burn-down with a visible bottom. Classifying a site is progress
even when no code changes, because the judgement is what was missing — and once `unclassified`
reaches 0, the remaining `defect` count is, for the first time, the honest size of the work
ISS-024 names.

## Non-goals for this slice

- **Not fixing the `node` defects.** Classification first: the size of that work is currently
  unknown, and guessing it is what produced the "111 sites" figure everyone quotes.
- **Not extending the scanner's shape coverage** (`||` fallbacks, template interpolation) —
  the documented gaps in `docs/NO_OS_RESOLUTION.md` stay documented gaps. Widening the net and
  changing the vocabulary in one slice would make the resulting number uninterpretable.
- **Not touching `packages/tractor/**`** (CLAUDE.md §8). ISS-023's Rust sibling resolver is
  named by this vocabulary but not moved by it.

## Verification

- The scanner's purpose parsing is PURE and unit-tested: marker on the same line, marker on the
  line above, an unknown purpose token (must be a loud error, not a silent "legitimate"), and a
  marker with no reason text (rejected — a purpose without a reason is the side table's failure
  mode moved inline).
- The classification is proven by the count, not by assertion: `unclassified` must fall by
  exactly the number of markers added, with `defect` accounted for separately.
- `docs/NO_OS_RESOLUTION.md` carries the dated breakdown, replacing the stale `117` it quotes
  today (the scanner reports 111, and the doc's "921 scanned files" is now 927).
