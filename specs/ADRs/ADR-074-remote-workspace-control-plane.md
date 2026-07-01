# ADR-074: Remote Workspace Control Plane

**Status**: Accepted
**Date**: 2026-06-30
**Authors**: Arthur Silva, Codex
**Related**: ADR-046 (Blocks and Distros), ADR-056 (Unified `refarm` Host Boundary),
ADR-057 (Task/Session Contracts), ADR-060 (Tractor HTTP Sidecar Protocol), ADR-072 (Consumer Leaf
Distribution Policy), ADR-073 (Capability Index Incubation Boundary),
`specs/features/dispatch-control-plane-contract.md`, `docs/CONVERGENCE_ROADMAP.md`

---

## Context

Refarm's long-term operator story includes a personal workspace that can coordinate work across
multiple machines: a home workstation, a laptop, a work computer when policy allows, a vault
checkout, and future agents running in parallel. The operator may interact through a local CLI, PWA,
Android app, Telegram, Matrix, or another channel, often over a private network such as Tailscale.

Refarm already has partial substrate for this:

- `task-contract-v1` and `session-contract-v1` model durable work and conversation memory;
- `effort-contract-v1`, `process-handoff`, and the Tractor sidecar model execution attempts;
- `dispatch-surface` models `file`, `http`, and `channel:<name>` control surfaces;
- `stream-contract-v1`, SSE, WebSocket, and file streams model live output;
- `channel-policy-v1` models provider-neutral delivery/review evidence;
- `source:v1` and workspace source materialization let Refarm inspect external workspaces;
- `silo` owns credential collection and namespacing;
- `environment-pressure` and operator finish lanes already expose local safety signals.

What is missing is the architectural boundary that says how those pieces converge into remote
workspace control without turning any one app or channel into the owner of the runtime.

## Decision

Refarm will pursue a **Remote Workspace Control Plane** as a long-term horizon.

A remote workspace is a declared, identity-bound Refarm node that can:

- advertise its workspace identity, capabilities, environment ceilings, and policy posture;
- accept bounded efforts through a control-plane adapter;
- stream progress and results through standard stream contracts;
- write artifacts, receipts, and audit evidence through standard contracts;
- support cancellation, retry, and status queries;
- participate in parallel work orchestration without exposing raw shell access by default.

The control plane is **transport-neutral**. Tailscale, LAN, SSH tunnels, HTTPS, Telegram, Matrix,
PWA push, Android intents, and future channels are adapters or operator surfaces, not the core
authority.

`apps/refarm` may be the default distro that renders and operates this topology, but the reusable
mechanics belong in packages/contracts. A PWA or Android app is a renderer/operator surface. A
Telegram or Matrix bridge is a channel adapter. A home workstation or work computer runs a Refarm
node. None of those surfaces owns the core remote-execution contract.

## Boundary Rules

- **Node identity is explicit**: a machine must be enrolled before it can receive work. Enrollment
  should bind a node id, public key or identity reference, allowed workspace roots, and human label.
- **Policy precedes execution**: remote efforts must pass policy checks before process launch,
  plugin execution, or source mutation.
- **No raw shell by default**: commands should flow through `process-handoff`, task/effort envelopes,
  or declared adapters. Raw shell is an elevated capability, not the first primitive.
- **Environment ceilings are part of dispatch**: a node can refuse, serialize, or degrade work when
  memory, disk, sandbox, or host policy makes a lane unsafe.
- **Channels are review surfaces**: Telegram/Matrix can submit, approve, cancel, or receive
  receipts, but provider APIs and message formatting stay adapter-owned.
- **Private network is optional substrate**: Tailscale is a strong expected fixture for personal
  use, but Refarm must not require it as the only transport.
- **Work policy is respected**: controlling a work computer is only in scope when the operator is
  allowed to do so. Refarm should make policy boundaries visible instead of bypassing them.

## Non-goals

- Do not add remote execution directly to `apps/refarm` as app-local logic.
- Do not make Telegram, Matrix, Tailscale, PWA, Android, or SSH the canonical protocol.
- Do not expose the Tractor loopback HTTP sidecar on a public interface without an explicit remote
  gateway, pairing, authentication, and policy layer.
- Do not turn `vault-seed` into the remote-control product. Vaults can be controlled workspaces or
  consumers, while Refarm owns reusable control substrate.

## Implementation Direction

The first product shape should be a read-only topology and plan surface before remote mutation:

1. Extend declared workspace metadata with remote node intent only after the contract shape is
   specified.
2. Add a package-owned remote workspace descriptor/manifest when a dogfood proof needs it.
3. Make `refarm workspace` able to show local, bridged, source-cache, and remote-node readiness in
   one report.
4. Route remote work through existing effort/task/process/stream/artifact contracts.
5. Add channel adapters as consumers of the control plane, starting with evidence/review flows before
   direct execution.
6. Prove one safe lane: query status, run a bounded read-only check, stream output, cancel, and emit
   artifact evidence.

## Promotion Signals

Create a new package only when one of these signals appears:

- two operator surfaces need the same remote workspace descriptor;
- a channel adapter needs to submit/review/cancel work without importing `apps/refarm`;
- a remote node proof needs a stable JSON contract for status and policy;
- a PWA/Android surface needs a browser-safe SDK;
- a non-Refarm consumer such as `vault-seed` or `agents-lab` needs to declare or inspect remote
  workspace capabilities.

Candidate future package names should be evaluated at that time. Examples include
`@refarm.dev/workspace-node-contract-v1`, `@refarm.dev/remote-control-policy-v1`, or a subpath under
an existing package if install closure and ownership remain light.

## Consequences

### Positive

- The personal multi-machine workflow becomes an explicit product horizon.
- Refarm can converge CLI, PWA, Android, Telegram, Matrix, and local runtimes without privileging
  one transport too early.
- Existing contracts gain a concrete orchestration target.
- `vault-seed` can keep channel/product UX while benefiting from Refarm control substrate later.
- Parallel work can be built through policy-aware dispatch instead of ad hoc SSH/shell scripts.

### Negative

- More architecture must be carried before the first visible remote-control feature lands.
- The package boundary is intentionally deferred until a proof creates real pressure.
- Operator UX has to explain node enrollment, trust, and policy boundaries clearly.

### Risks

- Remote control can become dangerous if implemented as raw command relay. Mitigation: bounded
  efforts, explicit node enrollment, policy checks, environment ceilings, audit evidence, and
  cancellation are required before mutation.
- The app can accrete orchestration logic. Mitigation: app surfaces render package-owned descriptors
  and call package-owned adapters.
- Channel bridges can leak provider-specific semantics upstream. Mitigation: channel adapters own
  provider APIs and formatting; Refarm owns neutral envelopes and control-plane contracts.
