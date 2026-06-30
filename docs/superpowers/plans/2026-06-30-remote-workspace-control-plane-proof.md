# Remote Workspace Control Plane Proof (Item 13) Plan

> Spec: `specs/features/2026-06-30-remote-workspace-control-plane-proof.md`.
> Goal: prove the smallest remote-workspace control loop without extracting a
> package or binding the architecture to a specific app/channel/transport.

## Task 1 - Proof Fixture

- Add a proof-local remote node descriptor fixture.
- Include node id, label, transport kind, workspace root/mode, capabilities,
  and policy flags.
- Keep the schema name marked as proof-only.
- Gate: descriptor is not exported as a public package contract.

## Task 2 - Status Shape

- Build a status payload from the descriptor.
- Include runtime readiness, allowed operations, refused operations, and
  environment pressure decision.
- Gate: status can be rendered by an app, but the shape is not owned by
  `apps/refarm`.

## Task 3 - Bounded Read-Only Effort

- Represent one read-only command through `process-handoff`.
- Prefer a cheap command such as `refarm check --next-action --json` or a
  single focused test fixture.
- Refuse mutation and raw shell by policy.
- Gate: no generic remote shell.

## Task 4 - Stream and Cancel Semantics

- Attach stream-shaped output to the proof.
- Represent cancellation as `cancelled`, `not-cancellable`,
  `already-complete`, or `refused-by-policy`.
- Gate: fast commands may simulate cancellation, but must not omit the cancel
  semantics.

## Task 5 - Evidence Envelope

- Emit a proof evidence object containing process, node descriptor reference,
  policy decisions, environment pressure summary, stream reference, and final
  status.
- Map the fields toward `artifact-contract-v1` without making
  `artifact-contract-v1` depend on the proof harness.

## Task 6 - Documentation And Boundary Guard

- Update roadmap/readiness when the proof exists.
- Keep tests guarding that Telegram, Matrix, Tailscale, PWA, Android, and
  `apps/refarm` are adapters/surfaces, not canonical protocol owners.
- Revisit package extraction only after a promotion signal appears.

## Non-Goals

- Do not expose the loopback Tractor sidecar publicly.
- Do not add a Tailscale, Telegram, Matrix, PWA, Android, or SSH adapter in the
  first proof.
- Do not create `@refarm.dev/workspace-node-contract-v1` or similar until a
  second consumer/proof requires it.
- Do not run broad app or Rust suites for the proof unless the touched code
  requires them.
