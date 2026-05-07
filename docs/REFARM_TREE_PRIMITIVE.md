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
refarm tree preview <target>
refarm tree fork --scope git <commit-ish> --name <branch-name>
refarm tree switch <branch-or-node-prefix>
```

Implemented first slice:

```bash
refarm tree list --scope session [--limit <count>] [--json]
refarm tree list --scope git [--limit <count>] [--json]
refarm tree list --scope all [--limit <count>] [--json]
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
`operation` discriminators and metadata shapes (`list`, `show`, `preview`, `fork`, or `switch`). `list --scope all` is read-only and combines currently supported session and git nodes into one envelope; `all` is intentionally unavailable for `show`, `preview`, `fork`, and `switch` until composite execution semantics are proven. Executing `refarm tree fork` is git-only in the current slice and intentionally keeps session forks behind `refarm sessions fork` until session tree mutation semantics are explicit. All-scope list output is sorted by timestamp descending, applies `--limit` after combining adapter nodes, and uses deterministic tie-breakers (`kind`, `metadata.shortId`, then `nodeId`) so renderer snapshots do not flap when adapters report equal timestamps. `preview` emits a dry-run envelope that recommends
`refarm sessions fork ...` for session fork timelines,
`refarm tree switch <session> ...` for session switch timelines,
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
current active-session pointer, recommend `refarm tree switch ...`, and do not
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
path segments, `.lock` ref lock files, or parent traversal. Tree list limits fail closed unless they are plain
integers from 1 to 200 and apply to session, git, and combined all-scope list output.

`preview` is the safety boundary. It materializes what would change without
moving the active pointer. Any future destructive or state-moving operation must
be explainable as "the preview became explicit execution".

## Local validation economy

Use the cheapest tree-specific signal during iteration:

```bash
npm run refarm:tree:test
npm run refarm:tree:smoke
```

`refarm:tree:test` runs the mocked command contract suite plus the shared
execution-plan readiness helper tests. `refarm:tree:smoke` runs a fast in-process
integration smoke against an isolated temp git repo, so it validates real
`git branch`/`git switch` behavior without exercising the entire host CLI flow.
Use the slower built CLI smoke only as a broader checkpoint. It now also
boots a local session sidecar stub when `:42001` is free, validates
`list --scope all`, proves `all` remains read-only, and switches a session under
an isolated temporary `HOME` before checking already-active guards:

```bash
npm run refarm:tree:smoke:cli
npm run refarm:host:smoke:cli
```

## JSON envelope invariants

Tree JSON envelopes are renderer contracts, not terminal transcripts. Keep these
rules stable while `schemaVersion` remains `1`:

- every envelope has `schemaVersion`, `command: "tree"`, `scope`, and
  `operation` at the top level;
- `preview` envelopes use `reason: "dry-run"` and contain `plan`, never
  `result`;
- executed `fork`/`switch` envelopes use `reason: "executed"` and contain
  `result`, never `plan`;
- generic plan fields (`action`, `destructive`, `readyToExecute`,
  `blockedReason`, `recommendedCommand`, and `effects`) stay substrate-neutral;
- substrate-specific facts stay under `plan.substrate` or `result`, including
  git refs/worktree state and session IDs/entry IDs;
- blocked previews should prefer successful JSON with `readyToExecute: false`
  when the target can be resolved safely, and reserve process failure for invalid
  input, missing/ambiguous targets, or unsupported execution surfaces.

These invariants let Web/TUI/headless renderers share readiness UI without
coupling to git/session mechanics.

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

## All-scope list JSON contract example

`scope: "all"` is a read-only aggregate list. It joins currently available
session and git timeline nodes but does not create a composite mutation surface.
When `--limit <n>` is provided, each adapter is requested with a bounded read
(`/sessions?limit=<n>` for sessions and `git log --max-count=<n>` for git)
before the combined timeline is sorted and sliced to the final limit:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "all",
  "operation": "list",
  "nodes": [
    {
      "timelineId": "git",
      "nodeId": "abcdef1234567890abcdef1234567890abcdef12",
      "parentNodeId": "1111111111111111111111111111111111111111",
      "branchId": "HEAD -> main",
      "kind": "git",
      "label": "seed",
      "timestamp": "2026-05-06T14:00:00+00:00",
      "metadata": {
        "shortId": "abcdef123456",
        "refs": ["HEAD -> main"]
      }
    },
    {
      "timelineId": "session",
      "nodeId": "urn:refarm:session:v1:abc123def456",
      "branchId": "urn:refarm:session:v1:abc123def456",
      "kind": "session",
      "label": "auth-refactor",
      "timestamp": "2023-11-14T22:13:20.000Z",
      "metadata": {
        "shortId": "abc123def456",
        "leafEntryId": "entry-2",
        "hasHistory": true
      }
    }
  ]
}
```

`show`, `preview`, `fork`, and `switch` still require an explicit substrate
scope. This keeps all-scope inspection useful without implying coordinated
multi-substrate execution.

## Session fork JSON contract examples

Session fork preview is a non-mutating readiness envelope. Session fork execution
remains delegated to `refarm sessions fork`, so `tree` currently emits only the
plan/readiness contract for this session operation:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "session",
  "operation": "preview",
  "reason": "dry-run",
  "plan": {
    "action": "fork",
    "destructive": false,
    "readyToExecute": false,
    "blockedReason": "Provide --name <branch-name> before executing session fork.",
    "recommendedCommand": "refarm sessions fork abc123def456 --at entry-2 --name <branch-name>",
    "effects": {
      "activePointerChanged": true,
      "branchCreated": true
    },
    "substrate": {
      "kind": "session-fork",
      "branchPointEntryId": "entry-2",
      "branchName": "<branch-name>",
      "activeSessionWillSwitch": true
    }
  }
}
```

With a safe branch name, the same preview becomes ready while remaining dry-run:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "session",
  "operation": "preview",
  "reason": "dry-run",
  "plan": {
    "action": "fork",
    "destructive": false,
    "readyToExecute": true,
    "recommendedCommand": "refarm sessions fork abc123def456 --at entry-1 --name safe/fork",
    "effects": {
      "activePointerChanged": true,
      "branchCreated": true
    },
    "substrate": {
      "kind": "session-fork",
      "branchPointEntryId": "entry-1",
      "branchName": "safe/fork",
      "activeSessionWillSwitch": true
    }
  }
}
```

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
    "recommendedCommand": "refarm tree switch abc123def456",
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
    "command": "refarm tree switch abc123def456"
  }
}
```

If the target is already active, preview stays non-mutating and reports
`readyToExecute: false` plus a deterministic `blockedReason`; execution rejects
before writing. If read-back verification after writing does not match the target,
execution fails closed.

## Git preview/execution JSON contract examples

Git fork preview stays non-mutating and, without `--name`, deliberately reports
`readyToExecute: false` while still describing the future branch effect:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "git",
  "operation": "preview",
  "reason": "dry-run",
  "plan": {
    "action": "fork",
    "destructive": false,
    "readyToExecute": false,
    "blockedReason": "Provide --name <branch-name> before executing tree fork.",
    "recommendedCommand": "refarm tree fork --scope git abcdef123456 --name <branch-name>",
    "effects": {
      "activePointerChanged": false,
      "branchCreated": true
    },
    "substrate": {
      "kind": "git-branch",
      "baseCommit": "abcdef1234567890abcdef1234567890abcdef12",
      "branchName": "<branch-name>",
      "worktreeSwitched": false
    }
  }
}
```

Git switch preview describes active-pointer movement but never calls
`git switch`. Dirty worktrees and already-active target branches keep the preview
successful while setting `readyToExecute: false` and a deterministic
`blockedReason`:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "git",
  "operation": "preview",
  "reason": "dry-run",
  "plan": {
    "action": "switch",
    "destructive": false,
    "readyToExecute": true,
    "recommendedCommand": "refarm tree switch --scope git safe/fork",
    "effects": {
      "activePointerChanged": true,
      "branchCreated": false
    },
    "substrate": {
      "kind": "git-switch",
      "worktreeClean": true,
      "currentRefBefore": "main",
      "targetRefAfter": "safe/fork",
      "targetCommit": "abcdef1234567890abcdef1234567890abcdef12",
      "worktreeSwitched": true
    }
  }
}
```

Executed git fork and switch envelopes report observed before/after refs. Fork is
non-switching by contract; switch is the only git tree operation that moves the
active worktree:

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "git",
  "operation": "fork",
  "reason": "executed",
  "result": {
    "kind": "git-branch",
    "destructive": false,
    "worktreeSwitched": false,
    "currentRefBefore": "main",
    "currentRefAfter": "main",
    "branchName": "safe/fork",
    "baseCommit": "abcdef1234567890abcdef1234567890abcdef12",
    "command": "git branch safe/fork abcdef123456"
  }
}
```

```json
{
  "schemaVersion": 1,
  "command": "tree",
  "scope": "git",
  "operation": "switch",
  "reason": "executed",
  "result": {
    "kind": "git-switch",
    "destructive": false,
    "worktreeSwitched": true,
    "currentRefBefore": "main",
    "currentRefAfter": "safe/fork",
    "branchName": "safe/fork",
    "targetCommit": "abcdef1234567890abcdef1234567890abcdef12",
    "command": "git switch safe/fork"
  }
}
```

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

## CRDT/composite read-only activation plan

The next substrate should enter through read-only nodes before any mutation is
allowed. A CRDT adapter is ready to participate in `tree list/show/preview` only
when it can expose all of the following without product-private assumptions:

- stable document or workspace timeline IDs;
- stable node IDs for frontiers, checkpoints, or named heads;
- parent/frontier ancestry that can be rendered without replaying arbitrary app
  state;
- human labels and timestamps suitable for operator inspection;
- metadata that stays adapter-local, such as frontier IDs, actor IDs, or
  checkpoint hashes.

Composite timelines should then join evidence instead of moving state. A
composite node can reference session, git, and CRDT observations, but its first
`preview` output should be coordinated-plan-only: `readyToExecute: false`, a
clear `blockedReason`, and substrate details that identify each selected adapter
node. Composite `fork`/`switch` should remain unavailable until rollback and
partial-failure semantics are deterministic.

Acceptance criteria for the read-only CRDT/composite slice:

1. `refarm tree list --scope crdt --json` or an equivalent guarded scope emits
   schema-versioned nodes without changing document state, and can later join
   `refarm tree list --scope all` without adding mutation paths.
2. `refarm tree show <crdt-node> --json` resolves exact or unambiguous prefixes
   and fails closed on ambiguity.
3. Composite preview can describe a multi-substrate plan, but no command mutates
   more than one substrate in a single execution path.
4. Existing session/git JSON envelopes remain backward-compatible at
   `schemaVersion: 1`.

## Deferred mutation and extraction queue

The current stabilization pass intentionally does **not** implement the following
items yet, but they are the next prepared orbit once the current session/git/all
contracts are stable:

| Deferred item | Earliest safe entry point | Required proof before execution |
| --- | --- | --- |
| CRDT mutation | After CRDT frontiers/checkpoints are visible as read-only tree nodes | Deterministic node IDs, ancestry, preview envelopes, and rollback/abort behavior for failed writes |
| Composite mutation | After session/git/CRDT nodes can be joined read-only | Coordinated plan envelope, selected substrate nodes, partial-failure semantics, and no hidden cross-substrate writes |
| Rewind | After `preview + switch/fork` semantics have covered real recovery workflows | Non-destructive preview that identifies whether rewind is a switch to an existing pointer or a fork from a historical node |
| `execution-plan` extraction | After a second real consumer outside `refarm tree` needs the same plan/readiness contract | Shared generic fields remain substrate-free and product-specific facts stay under adapter/substrate details |

Until those proofs exist, `tree` should continue to prefer read-only inspection,
blocked readiness envelopes, or explicit single-substrate execution.

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
8. ✅ Defer CRDT mutation, composite mutation, rewind, and execution-plan
   extraction behind the explicit proof gates above; keep the current tree slice
   focused on stable session/git/all timeline contracts.

## Non-goals

- No automatic multi-substrate rollback.
- No destructive rewind as the first command.
- No product-private metadata in common rows.
- No package extraction until `apps/refarm` has two working adapters or a second
  app independently consumes the same primitive.
