# ADR-094: Node Context, Workspace Hatch, and Sovereign Home Resolution

## Status
**Proposed**

## Context

Refarm already has several correct partial decisions that do not yet compose into one canonical
operator model:

- `workspaceId` is becoming an explicit wire field and must be declared, never inferred from cwd.
- the node's declaration base is being moved from process cwd to an injected, declared base.
- `silo` storage and Refarm runtime state are intentionally separable concerns.
- brand and path seams are moving toward injected context rather than hardcoded names.

What remains unresolved is the operational question the operator actually feels:

"Which sovereign state is active for this node right now, and how does that state relate to the
workspace I am acting on?"

Today the answer can split:

- the CLI credential flow may read or write `SILO_HOME || REFARM_HOME || ~/.silo`;
- the runtime launcher may default to `REFARM_HOME || ~/.refarm`;
- the workspace target may be declared explicitly as `workspaceId`;
- the current directory may still influence project-local behavior in a few places.

This produces an operator-hostile failure mode: one command says "all credentials already
configured" while another part of the same node refuses to start because the credential it needs is
not present in the home it is actually using.

This is not a mere CLI wording defect. It is a missing canonical model.

Refarm needs one architectural answer that separates:

- the logical target of work;
- the sovereign home and runtime state of the node;
- the explicit bridge between node and workspace;
- the extension theater that may sit on top later.

## Decision

Refarm will treat **node context**, **workspace identity**, and **workspace hatch** as three
separate but coordinated concepts.

### 1. `workspaceId` names the logical target, not the active sovereign state

`workspaceId` identifies the workspace a command, effort, or operation is addressing.

- It is declared on the wire when relevant.
- It is never inferred from cwd.
- It does not, by itself, choose the node's credential store, sovereign home, runtime namespace,
  or active provider.

### 2. Node context is a first-class runtime fact

Every Refarm node has one effective node context at a time. That context includes, at minimum:

- effective sovereign home;
- effective credential store;
- effective runtime namespace;
- effective model/provider routing defaults;
- effective runtime/process ownership.

Commands that inspect or mutate credentials, provider routing, runtime state, or node-owned policy
must resolve against an explicit node context and must be able to report that context.

### 3. A workspace hatch is the explicit bridge between a node and a workspace

A **workspace hatch** is a declared binding that says how this node operates a given workspace.

At minimum, a hatch records:

- `workspaceId`;
- workspace root or declared mount;
- sovereign-home mode;
- runtime namespace mode;
- credential posture;
- optional policy or bridge metadata.

The hatch is not the workspace itself and not the node itself. It is the operational context that
connects the two.

### 4. Context resolution is explicit and observable

The effective context for a command resolves in this order:

1. explicit command selection;
2. active hatch;
3. node-global default.

Cwd is not a context authority for node identity, credential home, or workspace selection.

Cwd may still matter for authoring-local behavior that is honestly about the current project, but it
must not answer questions about which sovereign node state is active.

### 5. Operator-facing commands must surface context, not conceal it

At minimum, the operator-facing surfaces for `sow`, `model current`, `runtime status`, `check`, and
future context-selection commands must report:

- effective sovereign home;
- effective credential source;
- active hatch or node-global mode;
- active `workspaceId`, when any;
- divergence warnings when multiple plausible homes or stores exist.

"All credentials already configured" without naming the context is not an acceptable steady-state
response.

### 6. Canonical behavior belongs in core; theatrical UX belongs in extensions

The following are canonical core responsibilities:

- context resolution;
- hatch resolution and persistence;
- credential/runtime/provider context binding;
- diagnostics and hardening;
- wire-visible `workspaceId` rules.

Richer operator experiences, menus, dashboards, or workflow choreography may live in apps,
extensions, plugins, or packages built on top of that core.

## Consequences

### Positive Consequences

- The operator gets one answer to "which home/context is active now?"
- `workspaceId` stops being overloaded as a hidden context selector.
- Runtime, credential, and provider failures become diagnosable rather than surprising.
- The future hatch concept becomes canonical infrastructure instead of app-local improvisation.
- Extensions can build richer context UIs without redefining the underlying truth.

### Negative Consequences

- Refarm will need a new explicit context vocabulary in CLI, runtime status, and storage.
- Existing flows that quietly relied on fallback behavior will become noisier before they become
  safer.
- Some current docs that describe `sow` or `REFARM_HOME` too simply will need correction.
- Introducing hatch semantics adds a new concept the operator must be able to inspect and control.

## Alternatives Considered

- **Keep extending `sow` and `runtime status` without a new model.** Rejected because the defect is
  structural: multiple context authorities already exist.
- **Make `workspaceId` imply home/runtime context.** Rejected because a logical workspace target is
  not identical to the node's sovereign state.
- **Force everything under one universal home.** Rejected because Refarm needs a node-global mode and
  a workspace-bound mode, and the distinction should be explicit rather than erased.
- **Leave context behavior to downstream apps or plugins.** Rejected because credential, runtime,
  and policy truth must be canonical and safe before any theatrical UX layers exist.

## Operationalization

- First BDD red scenario: `refarm sow` reports credentials configured from one store while
  `refarm runtime ensure` fails because the runtime resolves another home.
- First TDD red contract: a context/status surface must report effective sovereign home, credential
  source, and active hatch or node-global mode.
- First DDD green slice: introduce a node-context descriptor plus a minimal hatch descriptor and make
  `runtime status` and `model current` answer from the same resolved context.
- Verification commands:
  - `node apps/refarm/dist/index.js model current --json`
  - `node apps/refarm/dist/index.js runtime status --json`
  - `node apps/refarm/dist/index.js check --next-action --json`
  - focused tests for context/home resolution once the first implementation slice exists
