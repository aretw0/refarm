# Refarm Tree Primitive

Status: design baseline + session/git preview slices

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
refarm tree preview --scope git <commit-ish> [--name <branch-name>] [--json]
refarm tree preview --scope git <branch-name> --switch [--json]
refarm tree fork --scope git <commit-ish> --name <branch-name> [--json]
refarm tree switch --scope git <branch-name> [--json]
```

The first slices are intentionally conservative. Machine-readable tree envelopes
emit `schemaVersion: 1` directly at each producer and use explicit, scope-specific
`operation` discriminators and metadata shapes (`list`, `show`, `preview`, `fork`, or `switch`). `preview` emits a dry-run envelope that recommends
`refarm sessions fork ...` for session timelines, `refarm tree fork --scope git ...`
for git fork timelines, or `refarm tree switch --scope git ...` for git switch
plans, but does not fork, branch, check out, or switch. Git preview plans keep
command-level semantics generic (`action`, `destructive`, `readyToExecute`,
`blockedReason`, `recommendedCommand`, and `effects`) and place git-specific
details under `substrate`. Git fork preview effects declare
`worktreeSwitched: false`, while git switch preview effects declare
`worktreeSwitched: true`; git switch substrate details include
`currentRefBefore`/`targetRefAfter` and `worktreeClean`. Session previews may target a historical entry with
`--at <entry-id>` and fail closed if the entry is not in that session. `fork` is
explicit execution; the first executable slice is git-only and creates a branch
without switching the active worktree (`worktreeSwitched: false`, plus matching
`currentRefBefore`/`currentRefAfter` in JSON), fails closed when the target branch already exists, and rejects session-only
entry selectors (`--at`). `switch` is git-only in the first executable slice:
it requires an existing non-active branch, rejects dirty worktrees before moving
the active pointer, emits `currentRefBefore`/`currentRefAfter`, and verifies the
active ref after `git switch`. Session fork/switch execution remains delegated or rejected
until active-session switching semantics are made explicit in the tree contract.
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
| `switch` | Moves active pointer to an existing branch/head | Git-only first slice; requires an existing branch, clean worktree, and verified before/after refs |

Avoid a first-class `rewind` command until the preview + switch/fork semantics
are proven. "Rewind" is user language; the safe primitive is either:

1. `preview` + `switch` to an existing branch/head; or
2. `preview` + `fork` from a historical node.

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
boundary obvious, but the plan vocabulary should eventually move out of the tree
module and be reused by status actions, renderer actions, telemetry gates, and
other host-governed commands. Substrate-specific facts (`baseCommit`, git refs,
worktree cleanliness, session entry IDs, CRDT frontiers) should live under
adapter-specific details, not in the generic plan surface.

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
   active-ref verification; keep session switching rejected until active-session
   pointer semantics are explicit.
8. Defer CRDT and composite mutation until Loro frontiers/checkpoints are first
   exposed as read-only timeline nodes.

## Non-goals

- No automatic multi-substrate rollback.
- No destructive rewind as the first command.
- No product-private metadata in common rows.
- No package extraction until `apps/refarm` has two working adapters or a second
  app independently consumes the same primitive.
