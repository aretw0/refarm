# Refarm Tree Primitive

Status: design baseline + session/git preview/execution slices

## Why this exists

Refarm needs a `/tree`-style capability that is not tied to a single substrate.
The operator should be able to inspect history, preview a rewind, fork from any
point, and switch active work whether the history comes from an agent session, a
CRDT document, or git.

The primitive is **not** "session history with extra commands". It is a common
contract over timelines that can be projected by multiple adapters.

## Core model

```ts
interface RefarmTimelineNode {
  timelineId: string;
  nodeId: string;
  parentNodeId?: string;
  branchId?: string;
  kind: "session" | "crdt" | "git" | "composite";
  label: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

Required identity rules:

- `timelineId` scopes node identity to a substrate or composed view.
- `nodeId` must be stable inside a timeline and prefix-resolvable only when the
  prefix is unambiguous.
- `parentNodeId` is optional for roots and imported heads.
- `branchId` names a mutable pointer; nodes are immutable observations.
- `metadata` may carry adapter-local details, but command UX must not require
  product-private fields.

## Command UX

Initial product command family:

```bash
refarm tree list [--scope session|crdt|git|all]
refarm tree show <node-or-prefix>
refarm tree preview <node-or-prefix>
refarm tree fork <node-or-prefix> --name <branch-name>
refarm tree switch <branch-or-node-prefix>
```

Implemented first slice:

```bash
refarm tree list --scope session [--json]
refarm tree list --scope git [--limit <count>] [--json]
refarm tree show <session-id-or-prefix> [--json]
refarm tree show --scope git <commit-ish> [--json]
refarm tree preview <session-id-or-prefix> [--at <entry-id>] [--name <branch-name>] [--json]
refarm tree preview <session-id-or-prefix> --switch [--json]
refarm tree preview --scope git <commit-ish> [--name <branch-name>] [--json]
refarm tree preview --scope git <branch-name> --switch [--json]
refarm tree fork --scope git <commit-ish> --name <branch-name> [--json]
refarm tree switch <session-id-or-prefix> [--json]
refarm tree switch --scope git <branch-name> [--json]
```

The first slices are intentionally conservative. Machine-readable tree envelopes
emit `schemaVersion: 1` directly at each producer and use explicit, scope-specific
`operation` discriminators and metadata shapes (`list`, `show`, `preview`, `fork`, or `switch`). `preview` emits a dry-run envelope that recommends
`refarm sessions fork ...` for session fork timelines, `refarm sessions use ...`
or `refarm tree switch <session> ...` for session switch timelines,
`refarm tree fork --scope git ...` for git fork timelines, or
`refarm tree switch --scope git ...` for git switch plans, but does not fork,
branch, check out, or switch. Git preview plans keep
command-level semantics generic (`action`, `destructive`, `readyToExecute`,
`blockedReason`, `recommendedCommand`, and `effects`) and place git-specific
details under `substrate`. Tree preview effects declare generic timeline impact
such as `activePointerChanged` and `branchCreated`; git-specific worktree impact
stays in git substrate details (`worktreeSwitched`,
`currentRefBefore`/`targetRefAfter`, and `worktreeClean`). Session fork previews may target a historical entry with
`--at <entry-id>` and fail closed if the entry is not in that session. Session
switch previews are dry-run only: they resolve the target session, read the
current active-session pointer, recommend `refarm sessions use ...`, and do not
write `.refarm/session.lock`. `fork` is
explicit execution; the first executable slice is git-only and creates a branch
without switching the active worktree (`worktreeSwitched: false`, plus matching
`currentRefBefore`/`currentRefAfter` in JSON), fails closed when the target branch already exists, and rejects session-only
entry selectors (`--at`). `switch` execution is explicit: git switch requires
an existing non-active branch, rejects dirty worktrees before moving the active
pointer, emits `currentRefBefore`/`currentRefAfter`, and verifies the active ref
after `git switch`; session switch resolves a non-active target session, writes
`.refarm/session.lock`, verifies the active-session pointer after writing, and
emits `currentSessionIdBefore`/`currentSessionIdAfter`. Session fork execution
remains delegated to `refarm sessions fork`.
Session pointer mechanics are centralized in `apps/refarm/src/commands/session-lock.ts`:
all explicit active-session writes should use the shared read/write/verify helper
so `sessions`, `ask`, and `tree` preserve one definition of `.refarm/session.lock`.
Session identity and prefix resolution are centralized in
`apps/refarm/src/commands/session-ids.ts` so human commands and tree commands
share exact-match precedence, ambiguity errors, and short-ID formatting.

Preview/fork/switch branch names fail closed unless they contain
only safe git-style segments made from letters, numbers, `.`, `_`, `/`, or `-`
and do not look like CLI options, reserved refs (`HEAD`/`refs/...`), hidden/empty
path segments, `.lock` ref lock files, or parent traversal. Git list limits fail closed unless they are plain
integers from 1 to 200.

`preview` is the safety boundary. It materializes what would change without
moving the active pointer. Any future destructive or state-moving operation must
be explainable as "the preview became explicit execution".

## Local validation economy

Use the cheapest tree-specific signal during iteration:

```bash
npm run refarm:tree:test
npm run refarm:tree:smoke
```

`refarm:tree:test` runs the mocked command contract suite. `refarm:tree:smoke`
runs a fast in-process integration smoke against an isolated temp git repo, so it
validates real `git branch`/`git switch` behavior without exercising the entire
host CLI flow. Use the slower built CLI smoke only as a broader checkpoint:

```bash
npm run refarm:tree:smoke:cli
npm run refarm:host:smoke:cli
```

## Operation semantics

| Operation | Default behavior | Safety rule |
| --- | --- | --- |
| `list` | Read-only tree/branch rows | Never mutates active state |
| `show` | Read-only node detail | Fails on ambiguous prefixes |
| `preview` | Dry-run restore/fork/switch plan | Emits `reason: "dry-run"`; never mutates active state |
| `fork` | Creates a new branch pointer from an immutable node | Git-only first slice; creates a branch without switching |
| `switch` | Moves active pointer to an existing branch/head | Explicit execution only; git verifies branch/worktree refs, session verifies active-session pointer before/after writing |

Avoid a first-class `rewind` command until the preview + switch/fork semantics
are proven. "Rewind" is user language; the safe primitive is either:

1. `preview` + `switch` to an existing branch/head; or
2. `preview` + `fork` from a historical node.

## Session switch JSON contract examples

Session switch preview is a non-mutating readiness envelope:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "session",
  "operation": "preview",
  "reason": "dry-run",
  "plan": {
    "action": "switch",
    "destructive": false,
    "readyToExecute": true,
    "recommendedCommand": "refarm sessions use abc123def456",
    "effects": {
      "activePointerChanged": true,
      "branchCreated": false
    },
    "substrate": {
      "kind": "session-switch",
      "activeSessionIdBefore": "urn:refarm:session:v1:before",
      "targetSessionIdAfter": "urn:refarm:session:v1:abc123def456",
      "activeSessionWillSwitch": true
    }
  }
}
```

Explicit session switch execution is a result envelope, not a plan:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "session",
  "operation": "switch",
  "reason": "executed",
  "result": {
    "kind": "session-switch",
    "destructive": false,
    "activePointerChanged": true,
    "currentSessionIdBefore": "urn:refarm:session:v1:before",
    "currentSessionIdAfter": "urn:refarm:session:v1:abc123def456",
    "targetSessionId": "urn:refarm:session:v1:abc123def456",
    "command": "refarm sessions use abc123def456"
  }
}
```

If the target is already active, preview stays non-mutating and reports
`readyToExecute: false` plus a deterministic `blockedReason`; execution rejects
before writing. If read-back verification after writing does not match the target,
execution fails closed.

## Primitive boundary: timeline vs execution plan

This work is intentionally exposing two related primitives that should not stay
fused forever:

1. **Timeline primitive**: `tree list/show/preview/fork/switch` resolves stable
   nodes, branch points, and active pointers across substrates.
2. **Execution-plan primitive**: a generic affordance/readiness envelope for any
   command that can move state later, with `action`, `destructive`,
   `readyToExecute`, `blockedReason`, `recommendedCommand`, and generic
   `effects`.

`refarm tree` is the first consumer because timeline operations make the safety
boundary obvious. The shared type lives app-locally for now in
`apps/refarm/src/commands/execution-plan.ts`; it should move further out only
when status actions, renderer actions, telemetry gates, or another host-governed
command become a second real consumer. Substrate-specific facts (`baseCommit`,
git refs, worktree cleanliness, session entry IDs, CRDT frontiers) should live
under adapter-specific details, not in the generic plan surface.

## Adapter contract

Each adapter should expose the same shape:

```ts
interface RefarmTimelineAdapter {
  kind: RefarmTimelineNode["kind"];
  list(): Promise<readonly RefarmTimelineNode[]>;
  show(nodeId: string): Promise<RefarmTimelineNode | undefined>;
  preview(nodeId: string): Promise<RefarmTimelinePreview>;
  fork(nodeId: string, options: { name: string }): Promise<RefarmTimelineBranch>;
  switch(target: string): Promise<RefarmTimelineBranch>;
}
```

Adapters own substrate mechanics:

| Adapter | Node source | Fork maps to | Switch maps to |
| --- | --- | --- | --- |
| Session | session messages/events/checkpoints | new session branch | active session pointer |
| CRDT | Loro frontiers/checkpoints/heads | `forkAt(frontiers)` or checkpoint branch | active document head/frontier |
| Git | commits/refs/worktrees | branch or worktree from commit | checkout/worktree selection |
| Composite | joined session+CRDT+git evidence | coordinated plan only at first | no direct mutation until proven |

Composite timelines start read-only. Cross-substrate mutation must remain a
planned envelope until there is a deterministic rollback story.

## Fail-closed rules

- Ambiguous prefixes fail with deterministic retry choices.
- Missing nodes fail without falling back to "nearest" history.
- `fork` is allowed before destructive rewind because it preserves the current
  branch.
- `switch` must report the previous and next active pointers.
- Cross-adapter actions must emit an auditable envelope with selected adapter,
  resolved node, source branch, target branch, and dry-run/execute reason.
- Generated artifacts are observations, not timeline roots; source/git/CRDT
  state owns causality.

## First implementation slice

1. ✅ Keep this as the design baseline.
2. ✅ Implement session-only `refarm tree list/show/preview` over existing session
   data.
3. ✅ Add fail-closed tests for unsupported scopes and JSON contract tests for
   list/show/preview.
4. ✅ Add git adapter read-only list/show/preview because it provides an
   independent substrate without requiring CRDT migration work.
5. ✅ Add historical-entry session preview with `--at <entry-id>`.
6. ✅ Add explicit git `fork`/branch execution after preview output stabilized;
   keep it non-switching and isolated from session fork execution.
7. ✅ Add explicit git `switch` execution with clean-worktree and before/after
   active-ref verification; add dry-run and explicit execution for session
   active-session pointer switching.
8. Defer CRDT and composite mutation until Loro frontiers/checkpoints are first
   exposed as read-only timeline nodes.

## Non-goals

- No automatic multi-substrate rollback.
- No destructive rewind as the first command.
- No product-private metadata in common rows.
- No package extraction until `apps/refarm` has two working adapters or a second
  app independently consumes the same primitive.
