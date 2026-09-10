# Feature: node-context and workspace-hatch contract

**Status**: Draft
**Version**: post-v0.1.0 hardening lane
**Owner**: Refarm core maintainers

---

## Summary

Define a canonical operator/runtime contract that separates node context, workspace identity,
and workspace hatch. The feature ensures Refarm can always answer which sovereign home,
credential source, runtime namespace, and workspace binding are active, without inferring
critical state from cwd.

---

## Scope and Boundary

**In scope**:

- [ ] Canonical node-context descriptor
- [ ] Canonical workspace-hatch descriptor
- [ ] Context resolution order for CLI/runtime commands
- [ ] Context diagnostics for sow/runtime/model flows
- [ ] Minimal operator commands to inspect/select context

**Out of scope**:

- [ ] Final mobile/desktop UX choreography
- [ ] Rich hatch dashboards and non-canonical theater
- [ ] Provider-specific UX polish beyond canonical contracts

---

## User Stories

**As a** Refarm operator
**I want** to know exactly which sovereign home and credential source are active
**So that** I do not get conflicting "configured" versus "runtime missing credential" states.

**As a** Refarm operator
**I want** workspace identity and node context to be explicit and separate
**So that** workspace targeting does not silently alter runtime/credential authority.

**As a** Refarm maintainer
**I want** TS CLI and Rust runtime to report the same effective context facts
**So that** diagnosis and hardening are deterministic across surfaces.

---

## Acceptance Criteria

1. **Given** a node with multiple possible homes (`SILO_HOME`, `REFARM_HOME`, default home)
   **When** `refarm model current --json` and `refarm runtime status --json` are run
   **Then** both outputs include explicit context metadata and either agree or report divergence.

2. **Given** a command targets a workspace with `workspaceId`
   **When** no hatch is active and no explicit context selector is provided
   **Then** the command resolves through node-global context and does not infer context from cwd.

3. **Given** a hatch is active for a workspace
   **When** `refarm sow` runs
   **Then** the command reports the active context mode (`node-global` or `workspace-hatch`) and
   the effective home/store it used.

4. **Given** runtime startup and model credential state disagree by home/store
   **When** `refarm check --next-action --json` runs
   **Then** the response includes a context-divergence diagnostic with next commands.

---

## Bounded Context and Ubiquitous Language (DDD)

**Bounded context**: operator context and runtime context resolution

**Core entities / value objects**:

- [ ] NodeContextDescriptor
- [ ] WorkspaceHatchDescriptor
- [ ] ContextResolutionResult
- [ ] ContextDivergenceDiagnostic

**Ubiquitous language terms**:

- [ ] `workspaceId` -> logical target identity, never inferred from cwd
- [ ] `node context` -> effective sovereign operating state of the node
- [ ] `workspace hatch` -> declared operational bridge between node context and workspace identity
- [ ] `context mode` -> `node-global` or `workspace-hatch`

---

## Technical Approach

**High-level design:**

- Introduce a node-context descriptor emitted consistently by CLI and runtime status surfaces.
- Introduce a minimal workspace-hatch descriptor persisted under node-owned state.
- Resolve context in this order: explicit selector -> active hatch -> node-global default.
- Surface context in model/runtime/sow/check outputs.
- Emit divergence diagnostics when homes or stores disagree.

**Key decisions:**

- Canonical model owned by core, not by app-only UX.
- `workspaceId` remains a wire-level target identity, not a hidden home selector.
- cwd is not a context authority for node identity/credential/runtime selection.

---

## API/Interface

```typescript
export interface NodeContextDescriptor {
  mode: "node-global" | "workspace-hatch";
  sovereignHome: string;
  credentialStore: string;
  runtimeNamespace: string;
  providerRef?: string;
  workspaceId?: string;
}

export interface WorkspaceHatchDescriptor {
  workspaceId: string;
  root: string;
  homeMode: "inherit-node" | "workspace-home" | "dedicated-home";
  credentialMode: "inherit-node" | "workspace-owned" | "explicit-provider-only";
  runtimeNamespaceMode: "inherit-node" | "workspace-id" | "explicit";
}
```

---

## Traceability Matrix (SDD -> BDD -> TDD -> DDD)

| Requirement / Decision | SDD source | BDD test file | TDD test file | DDD implementation |
| --- | --- | --- | --- | --- |
| Context is explicit and observable | ADR-094 + this feature spec | apps/refarm test command integration | apps/refarm command unit tests | apps/refarm command surfaces + runtime status adapter |
| `workspaceId` is target-only | ADR-094 | dispatch/workspace integration tests | parse/validation unit tests | dispatch path + context resolver |
| Divergence is surfaced | ADR-094 + declared-node-base design | doctor/check integration tests | diagnostic builder unit tests | runtime/check/model/sow diagnostics |

---

## Test Coverage

**Integration tests** (BDD):

- [ ] context metadata present in `model current`, `runtime status`, and `sow`
- [ ] hatch activation changes context mode predictably
- [ ] divergence diagnostic appears with actionable `nextCommand`

**Unit tests** (TDD):

- [ ] context resolution precedence
- [ ] descriptor serialization and backward compatibility
- [ ] divergence detection logic

---

## Implementation Tasks

**SDD:**

- [x] ADR-094 proposed and indexed
- [x] Design companion in docs/superpowers/specs
- [x] This feature contract

**BDD:**

- [ ] add command-level integration tests for context metadata and divergence paths

**TDD:**

- [ ] add unit tests for context resolution and diagnostics

**DDD:**

- [ ] implement node-context descriptor plumbing
- [ ] implement minimal hatch descriptor persistence and selection
- [ ] wire context output in `sow`, `model current`, `runtime status`, `check`

---

## Execution Plan (Red -> Green)

**Gate 1 (SDD ready):**

- [x] ADR/spec approved for coding
- [x] No TODO/TBD in critical sections

**Gate 2 (BDD red):**

- [ ] integration tests for context metadata and divergence added and failing

**Gate 3 (TDD red):**

- [ ] unit tests for precedence/diagnostics added and failing

**Gate 4 (DDD green):**

- [ ] BDD tests pass
- [ ] TDD tests pass
- [ ] operator docs updated

**Evidence commands (to fill with exact command set during implementation):**

- BDD red: `pnpm ...`
- TDD red: `pnpm ...`
- Green/full verify: `pnpm ...`

---

## References

- [ADR-094](../ADRs/ADR-094-node-context-workspace-hatch-and-sovereign-home-resolution.md)
- [ADR-071](../ADRs/ADR-071-workspace-namespace-policy.md)
- [ADR-076](../ADRs/ADR-076-silo-storage-identity-closure-separation.md)
- [ADR-087](../ADRs/ADR-087-brand-agnostic-packages.md)
- [Declared node base design](../../docs/superpowers/specs/2026-08-03-declared-node-base-design.md)
- [Node context and workspace hatch design](../../docs/superpowers/specs/2026-08-04-node-context-workspace-hatch-design.md)
