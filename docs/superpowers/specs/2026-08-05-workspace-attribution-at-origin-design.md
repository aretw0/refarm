# Workspace Attribution at the Origin

Date: 2026-08-05
Status: proposed
Related: ADR-094 (Proposed, unimplemented), 2026-08-04 node-context-workspace-hatch design,
2026-08-03 budget-laboratory design, `docs/DECLARE_ONCE_INVARIANT.md`

## Why this exists

The operator asked to know what he is spending, on what, and with what. The handoff recorded the
answer as "cost separation is RECORDED but not QUERYABLE" and pointed at a missing query surface.

Measurement on 2026-08-05 found that framing too kind.

### What was measured, not argued

`refarm budget observations --limit 500 --json`, 23 observations, window 2026-08-03T21:21 →
2026-08-05T10:52:

| Axis | Coverage | Reading |
| --- | --- | --- |
| `refarm.cost.estimated_usd` | 23/23, **sum US$ 0.00** | 23/23 are `subscription`; every dollar ceiling measures nothing |
| `refarm.workspace.id` | **2/23 — and 0/16 on `refarm ask`** | the axis that separates project from project is blank on the operator's own surface |
| `refarm.scenario.id` | 7/23 | only what was hand-declared during the 08-05 bench work |
| `refarm.verification.passed` | 4/23 | 3 matched, 1 not matched (the deliberate negative) |
| `host.name` | 15/23 | one node represented, `sede`; 7 records predate node identity |
| `refarm.budget.spawner` | 23/23 | `refarm-ask` 16, `capability-dispatch` 7 |
| requests/day | 3 → 7 → 13 | the axis that actually binds, and already countable |

Tokens in the window: 55,824 input, 560 output, 6,144 cache-read, 0 cache-creation.

The conclusion the numbers force: **the record is not merely unqueryable on the workspace axis, it is
blank there — on 100% of the runs from the surface the operator uses.** A query surface built first
would report `unknown` for 91% of the record, and no past observation can be back-filled. Records
written blind stay blind.

That reorders the work. Closing the origin precedes building the question.

### Why the axis is blank

`Effort.workspace_id` is plumbed end to end already — the struct field
(`packages/tractor/src/sidecar/mod.rs:147-154`), the observation writer
(`sidecar/observation.rs:323,478`), `--workspace` on `dispatch capability`, and
`workspaceIdFromOperationId` for remotely initiated operations.

`refarm ask` has no `--workspace` flag at all. This is not a fill bug in a wired path; it is a
surface that never received the axis. That is why the 2/23 that carry a workspace all came from
`capability-dispatch`, and why all 16 `refarm ask` runs carry none.

## Decision

The workspace of a dispatch is a **declaration carried on the session**.

`refarm ask` resolves in four degrees:

```
1. --workspace <id>       explicit: declares on the session and applies to this run
2. session declaration    inherited; nothing typed
3. cwd seed               ONLY at session creation (path → id)
4. none                   outside every declared root; absent means absent
```

Degree 3 runs exactly once in a session's life. Continuing a session from another directory does not
change its attribution — what was declared stays declared. This is `DECLARE_ONCE_INVARIANT` applied
to the axis.

### Why the session, and not the cwd, is the carrier

The operator's stated daily surfaces are Telegram, Termux, and a PWA. **None of them has a working
directory.** A cwd-resolved axis would fix the terminal and leave blank precisely the surfaces he
intends to live in.

A session is already a durable node: the sidecar serves `/sessions` from `NativeStorage` via
`query_nodes("Session")`, so a session — and anything declared on it — survives a node restart. A
Telegram thread maps onto a session naturally, which also delivers the isolation the operator
described: one thread, one session, one workspace, each guarded from the others, rather than every
workspace piling into a single conversation. The node may open further sessions per workspace on the
same principle.

A local TUI has a cwd and therefore seeds through degree 3, exactly like the CLI. The hybrid is
served by one rule, not two.

## Reconciliation with ADR-094 and the hatch design

The hatch design's Goal 3 is to bind a workspace to a node "without using cwd magic", D2 states "cwd
is not part of this order", and H2 states:

> Cwd may inform **authoring convenience**, but not node identity, policy default, or credential
> truth.

This design is conformant, and the distinction is load-bearing rather than a technicality:

- **cwd is never consulted at dispatch time.** It is not in the resolution order. Degrees 1–4 above
  read a declaration or nothing.
- **cwd touches the system exactly once, at session birth, and what it writes is a declaration.**
  From that instant the authority is the declared `workspace_id` on the session node.
- **The workspace selects budget folds and, later, per-workspace policy** (hatch D3, and the
  per-workspace auth policy noted at `sidecar/mod.rs:149`). A seed that silently became policy input
  would breach H2 in substance while honouring it in form.

Therefore the seed is recorded with its provenance. The session carries **how** its workspace was
set, in a field named `workspace_source` taking exactly two values — `declared` (a human typed
`--workspace`) or `seeded-from-cwd` (inferred at session birth) — so any later consumer, and the
operator, can tell a typed declaration from a convenience inference. A session with no workspace
carries neither field. This is the same per-fact provenance discipline the rate catalog already
carries.

ADR-094 is **Proposed** and unimplemented: `refarm context` does not exist as a command. When the
hatch lands, it enters the order between degrees 1 and 2 — above the session's inherited declaration,
below the explicit selector — and the provenance marker is what lets an implementer merge the two
without guessing which values were ever authored by a human.

## Components

| Piece | Location | Status |
| --- | --- | --- |
| `workspace_id` + provenance on the `Session` node | `packages/tractor/src/sidecar/` | new fields, additive |
| path → id reverse resolution | `apps/refarm/src/` | **entirely new** |
| `--workspace` on `refarm ask` | `apps/refarm/src/commands/ask.ts` | new flag |
| `Effort.workspace_id` population | already plumbed | begins receiving a value |

`SessionNode` is JSON-LD (`@id`, `@type`, `name`, `created_at_ns`, `leaf_entry_id`,
`parent_session_id`, `participants`). Two added fields are additive: no existing reader breaks on an
extra key.

## The resolution rule

Resolution today runs one way only — id → path, via `declaredWorkspaceFromConfig`. The inverse does
not exist anywhere in the tree. Two workspaces are declared on this node: `rcdc5`
(`/home/s095407044/git/rcdc5/rcdc5`) and `refarm` (`/home/s095407044/github/refarm`).

Rules:

- **Longest matching prefix wins.** Should a root ever be declared inside another, being within the
  inner one attributes to the inner one.
- **Symlinks resolve before comparison.** Otherwise the same directory attributes differently
  depending on which path was typed.
- **A prefix match must fall on a path boundary.** `/home/op/refarm-old` is not inside
  `/home/op/refarm`.
- **Outside every declared root yields none.** Never a guess, never a nearest match.

## Verification

- Resolution: inside, outside, nested roots, symlinked path, sibling with a shared string prefix, no
  declarations at all.
- Precedence: each of the four degrees, including that continuing a session from another directory
  does not steal its attribution, and that `--workspace` re-declares.
- Provenance: an explicit flag records `declared`; a cwd seed records `seeded-from-cwd`.
- End to end: a real `refarm ask` leaves an observation carrying `refarm.workspace.id` — the check
  that today's measurement fails 16/16.

## Named seams

1. **Node-created sessions have no seeding path.** The cwd seed lives on the CLI/TUI side. A session
   opened by the node for Telegram or the PWA has no working directory and is born without an axis
   until something declares one. This slice does not close that; it makes closing it possible, by
   giving the session a field to declare into. The surface-side declaration (a `/workspace` command
   in a Telegram thread, or binding a thread to a workspace at creation) is separate work.
2. **The hatch is not built.** The degree reserved for it, between the explicit selector and the
   session's inherited declaration, is described above and implemented by nothing.
3. **Past records stay blank.** 21 of 23 existing observations carry no workspace and never will.
   Any report over the full history must show them as unknown rather than assign them.

## Non-goals

- **`refarm budget summary` is out of scope.** It reads a record that has not been written yet.
  Building the query before the origin produces a report over blanks. It follows in the next slice,
  over data that exists.
- **The fourth axis (quota per billing period) is out of scope.** It is separately specified as a gap
  in the budget-laboratory design, needs no new counter, and touches a three-level fold with a
  hardcoded signature.
- **No back-filling.** Past observations are not rewritten. The record is append-only and honest.
