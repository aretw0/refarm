# Node Context and Workspace Hatch Design

Date: 2026-08-04
Status: proposed design companion to ADR-094
Related: ADR-071, ADR-074, ADR-076, ADR-087, 2026-08-03 declared-node-base design

## Why this exists

Refarm already has several good partial answers:

- workspace identity is becoming declared on the wire;
- the node base is becoming declared rather than inherited from cwd;
- Silo separates credential storage from heavier identity closure concerns;
- the white-label doctrine pushes brand and path ownership toward injected context.

But the operator still lacks one canonical answer to the practical question:

"What node state am I operating right now, and how does it bind to this workspace?"

This design introduces the missing middle term: the workspace hatch.

## Goals

1. Separate node-global state from workspace-target identity.
2. Make the active sovereign home and credential source observable.
3. Give Refarm an explicit place to bind a workspace to a node without using cwd magic.
4. Keep the core model small and canonical so richer UX can live in apps/extensions later.
5. Harden the system against silent wrong-home, wrong-store, and wrong-runtime behavior.

## Non-goals

1. This does not design the final menu or mobile UX.
2. This does not require all commands to become workspace-bound immediately.
3. This does not eliminate node-global operation.
4. This does not move theatrical orchestration into core packages.

## Vocabulary

### Node context

The effective sovereign operating context of a Refarm node.

Fields the system must be able to answer:

- sovereign home
- credential store path/source
- runtime namespace
- provider/model routing source
- runtime ownership/liveness descriptor

### Workspace identity

The logical target of an operation, named as `workspaceId`.

It is declared, never inferred from cwd.

### Workspace hatch

The declared operational bridge between a node context and a workspace identity.

Minimal conceptual shape:

```json
{
  "workspaceId": "rcdc5",
  "root": "/home/op/github/rcdc5",
  "homeMode": "inherit-node",
  "runtimeNamespaceMode": "workspace-id",
  "credentialMode": "inherit-node",
  "policyMode": "workspace-declared"
}
```

Suggested mode families:

- `homeMode`: `inherit-node` | `workspace-home` | `dedicated-home`
- `credentialMode`: `inherit-node` | `workspace-owned` | `explicit-provider-only`
- `runtimeNamespaceMode`: `inherit-node` | `workspace-id` | `explicit`

## Core design rules

### D1. One command, one resolved context

Any command that touches credentials, runtime, provider routing, or node-owned policy must resolve a
single effective context before acting.

That answer must be inspectable.

### D2. Resolution order

Proposed resolution order:

1. explicit command context selector
2. active hatch
3. node-global default

Cwd is not part of this order.

### D3. `workspaceId` is not a secret context tunnel

`workspaceId` may select budgets, policy folds, and declared workspace-owned behavior, but it must
not silently pick a different credential store or sovereign home unless a hatch explicitly says so.

### D4. "Configured" must name where

Any success answer about configuration must carry context metadata. For example:

- which home was checked
- which store was used
- whether the result belongs to node-global or a hatch
- which provider/model is effective

### D5. Divergence is a surfaced state

If Silo, runtime, and workspace-local state disagree, the system must surface a divergence finding
instead of picking one silently and pretending the answer is obvious.

## Suggested command surface

This is a design target, not a rollout demand.

### `refarm context`

Reports the effective node context.

Minimum output:

- `mode`: `node-global` or `workspace-hatch`
- `home`
- `credentialSource`
- `runtimeNamespace`
- `workspaceId` when active
- divergence warnings

### `refarm hatch list`

Lists declared hatches visible to the node.

### `refarm hatch use <workspaceId>`

Activates a hatch for subsequent commands in the operator surface.

### `refarm hatch open <workspaceId> --root <path>`

Creates or materializes a hatch binding.

### `refarm sow`

Operates on the active context and says so explicitly.

Examples:

- configuring node-global credentials
- configuring a workspace hatch that inherits node credentials
- refusing because a workspace-owned credential mode is declared but missing

### `refarm runtime ensure`

Starts or ensures the runtime for the active context, not an implicitly mixed context.

## Hardening considerations

### H1. No silent fallback across homes

If multiple candidate homes exist, the operator must be able to see which one won and why.

### H2. No cwd-derived authority

Cwd may inform authoring convenience, but not node identity, policy default, or credential truth.

### H3. Context answers must compose across TS and Rust

The TypeScript CLI and Rust runtime must be able to emit the same effective context facts. If one
answers from `~/.silo` and the other from `~/.refarm`, that is a bug or a declared divergence, not
an implementation detail.

### H4. Node-global remains valid

The hatch concept must not force every operator into workspace-bound behavior. Refarm still needs a
boring node-global mode.

### H5. Extensions may decorate, not redefine

Apps, plugins, and downstream packages may add richer menus, mobile flows, dashboards, and
project-specific choreography, but they must not redefine context resolution rules.

## Proposed rollout

### Phase 1 — observability first

Without changing the whole UX yet:

- teach `model current`, `runtime status`, and `sow` to print the effective home/context
- surface divergence between runtime home and credential home
- document the current mismatch zones in operator-facing docs

### Phase 2 — minimal node-context descriptor

- add a canonical node-context descriptor type
- make TS and Rust report against the same descriptor fields

### Phase 3 — minimal hatch descriptor

- introduce persisted hatch declarations
- allow explicit hatch activation
- bind runtime namespace and provider flows to the active hatch or node-global context

### Phase 4 — product surfaces

- add richer UX in apps or plugins
- keep the canonical model in core packages and host/runtime boundaries

## Why this belongs in core, not in theater

The following are core truths, not UX sugar:

- where credentials live
- which runtime state is active
- which workspace is being addressed
- how a node is bound to a workspace
- which policy applies

Those answers must be canonical early. Menus, dashboards, and tailored flows can come later through
extensions, plugins, or app surfaces.