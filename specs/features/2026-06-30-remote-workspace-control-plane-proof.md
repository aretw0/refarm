# Spec: Remote Workspace Control Plane Proof (Roadmap Item 13)

**Status:** READY FOR FIRST PROOF - no package extraction yet
**Date:** 2026-06-30
**Related:** ADR-074, `docs/CONVERGENCE_ROADMAP.md` item 13,
`specs/features/dispatch-control-plane-contract.md`,
`specs/features/2026-06-26-process-handoff-provenance-bridge.md`,
`specs/features/2026-06-26-channel-policy-bridge.md`

## Context

ADR-074 accepts the remote workspace control plane as a long-term horizon:
operate bounded work across enrolled machines without making `apps/refarm`,
Telegram, Matrix, Tailscale, PWA, Android, or SSH the owner of the runtime.

The first proof must be deliberately smaller than "remote execution product".
It should prove the control loop and safety invariants while avoiding package
extraction before there is real pressure.

## Goal

Prove that Refarm can model one enrolled remote workspace node and one bounded
read-only effort with:

1. node status/readiness;
2. policy and environment ceiling checks before dispatch;
3. process handoff for the bounded command;
4. stream output;
5. cancellation;
6. artifact/audit evidence.

The proof may use a local fixture or loopback node before real machine-to-machine
transport. The proof must still model the remote boundary explicitly so the next
step can replace loopback with a real private-network adapter.

## First Proof Shape

### Remote node descriptor

The proof uses a descriptor with the minimum fields needed by operator surfaces:

```json
{
  "schema": "refarm.remote-workspace-node.proof.v1",
  "nodeId": "home-workstation",
  "label": "Home workstation",
  "transport": {
    "kind": "loopback",
    "endpoint": "http://127.0.0.1:42001"
  },
  "workspace": {
    "id": "refarm",
    "root": "/workspaces/refarm",
    "mode": "read-only"
  },
  "capabilities": {
    "status": true,
    "boundedReadOnlyProcess": true,
    "stream": true,
    "cancel": true,
    "artifactEvidence": true
  },
  "policy": {
    "rawShell": false,
    "mutation": false,
    "requiresHumanApproval": false
  }
}
```

This descriptor is proof-local until a second consumer needs it as a stable SDK
contract.

### Read-only effort

The first effort should be boring and bounded, such as:

- `refarm check --next-action --json` against a visible workspace;
- `git status --short` against a declared read-only checkout;
- `node --test` for a single fixture test that does not mutate source.

The command must be represented as a tokenized process spec through
`process-handoff`, not as a shell string.

### Status and readiness

The node status payload must include:

- node id and label;
- transport kind;
- workspace id/root/mode;
- runtime readiness;
- environment pressure decision;
- allowed operations;
- refused operations with reasons.

### Stream and cancel

The proof must use a standard stream contract or a fixture shaped like
`stream-contract-v1`. Cancellation can be simulated if the bounded command is
too fast, but the payload must distinguish:

- `cancelled`;
- `not-cancellable`;
- `already-complete`;
- `refused-by-policy`.

### Evidence

The proof must emit a small evidence object that can later map into
`artifact-contract-v1`:

- process spec;
- node descriptor reference;
- started/completed timestamps;
- final status;
- stream reference;
- policy decisions;
- environment pressure summary.

## Boundaries

Refarm owns:

- remote node descriptor shape for the proof;
- status/readiness and policy-before-dispatch semantics;
- process/stream/evidence composition;
- environment ceiling refusal/degrade behavior.

Adapters own:

- Tailscale, LAN, SSH tunnel, HTTPS, Telegram, Matrix, PWA, Android, or other
  transport-specific details;
- provider authentication and message formatting;
- mobile or browser-specific UX.

Apps own:

- rendering;
- command labels;
- operator flows;
- product defaults.

Apps do not own the reusable control contract.

## Activation Rules

Do not extract a package yet. The next implementation slice should stay in a
proof harness or CLI/workspace fixture unless one of these happens:

- two operator surfaces need the descriptor;
- a browser/PWA client needs a browser-safe SDK;
- a channel adapter needs to submit/review/cancel without importing
  `apps/refarm`;
- a downstream consumer needs to inspect remote node readiness;
- release/CI needs the descriptor as a stable JSON contract.

## Verification

The first implementation proof is accepted when:

- a fixture descriptor validates structurally;
- a status command reports allowed/refused operations;
- a bounded read-only effort is planned through `process-handoff`;
- stream output is visible through the standard stream shape;
- cancel semantics are represented even if the first command completes before
  cancellation;
- evidence includes process, policy, environment, stream, and node references;
- docs/tests prove no Telegram/Matrix/Tailscale/PWA/Android/app-specific
  protocol became canonical.

## Rollback

If remote proof work stalls, keep ADR-074 and this spec as horizon guidance.
Continue using local `refarm workspace`, `source:v1`, `process-handoff`, and
channel-policy proofs independently. No package publication depends on this
proof until a later release policy explicitly selects it.
