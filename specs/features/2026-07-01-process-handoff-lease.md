# Spec: Process Handoff Lease (`process-handoff/lease`)

**Status:** DECISION BASELINE — implementation candidate for `@refarm.dev/process-handoff`
**Date:** 2026-07-01
**Related:** `@refarm.dev/process-handoff`, `refarm web`, ADR-078, ADR-074,
`apps/site`, `apps/dev`

---

## Context

Local previews and developer services currently start as plain processes. That is enough for a
single terminal, but it fails the shared-container posture: a site preview can keep a port after the
agent session loses track of it, a new preview can move to another port, and the operator has to
recover with process inspection or a Codex `/stop`.

The incident that exposed this was not a duplicate Tractor. Tractor was one runtime process exposing
two expected listeners. The leak was two Astro previews: an old `apps/site` preview on `4322` and a
new one on `4323`, both owned by the coding-agent session rather than by a Refarm-visible lease.

## Decision

Process governance belongs below apps, in a neutral process primitive, not in `apps/site`, not in the
future Studio, and not in the Refarm runtime product surface. The long-term home is a build-free
subpath or sibling package around `@refarm.dev/process-handoff`:

```text
@refarm.dev/process-handoff/lease
# or, if the API grows enough:
@refarm.dev/process-lease
```

The first consumer should be `refarm web` because it already resolves structured process handoffs.
`apps/site` and the future Studio are targets of that primitive, not owners of it.

## Boundary

The lease primitive owns:

- process target identity (`site`, `studio`, `runtime-smoke`, `consumer-preview`, or another
  caller-defined id);
- tokenized command, args, cwd, display, and package-manager metadata from `ProcessHandoffSpec`;
- owner/session metadata, start time, pid when available, expected ports, health URL, log path, and
  stop policy;
- status classification: `starting`, `running`, `stale`, `exited`, `unreachable`, `stopped`;
- stale-port refusal before launching a replacement unless the listener is proven to be the same
  lease;
- deterministic JSON output for `status`, `list`, `stop`, and `cleanup`.

The lease primitive does not own:

- public site routes, GitHub Pages, or records/credentials context documents;
- Studio UX, runtime-agent workflows, plugin surfaces, or Homestead workbenches;
- kernel cgroup enforcement from ADR-078;
- remote workspace dispatch from ADR-074.

## Shape

```ts
export interface ProcessHandoffLeaseV1 {
  schemaVersion: 1;
  leaseId: string;
  targetId: string;
  owner: string;
  cwd: string;
  process: ProcessHandoffSpec;
  pid?: number;
  ports?: number[];
  urls?: string[];
  healthUrl?: string;
  logPath?: string;
  status: "starting" | "running" | "stale" | "exited" | "unreachable" | "stopped";
  startedAt: string;
  updatedAt: string;
  stop: {
    signal: "SIGTERM" | "SIGINT";
    timeoutMs: number;
  };
}
```

The local registry should live under `.refarm/processes/` by default so it is workspace-scoped,
inspectable, and removable without touching generated build artifacts. Consumers may override the
registry root for tests or embedded products.

## CLI Contract

The Refarm CLI should expose the primitive without confusing product surfaces:

```text
refarm process list --json
refarm process status <target-or-lease> --json
refarm process stop <target-or-lease> --json
refarm process cleanup --stale --json
refarm web --launch --target site --json
```

`refarm web` remains the renderer/operator command. It can launch `site` or `studio` targets, but the
target decides the app. The public `apps/site` target should be documented as docs/Pages preview.
The Studio target remains the operational web surface for runtime dogfood and agent workflows.

## Acceptance

1. Launching a preview writes a lease before handing control to a long-running process.
2. A second launch on the same target checks the existing lease and refuses or reuses it
   deterministically.
3. `refarm process stop <target>` stops the owned process and updates the lease.
4. A stale port without a matching lease returns an explicit blocked status instead of silently
   falling through to another port.
5. `refarm check --next-action --json` may report stale process leases as advisory at first, then as
   a stricter gate once the primitive is proven.

## Release Posture

This is not required to publish the current `vault-seed-ready` package lane. It is a follow-up that
protects the shared environment and makes future site/Studio previews operationally boring.
