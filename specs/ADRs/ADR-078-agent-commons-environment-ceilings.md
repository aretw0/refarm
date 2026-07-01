# ADR-078: Agent-Commons Environment Ceilings

**Status**: Proposed
**Date**: 2026-06-30
**Authors**: Arthur Silva, Claude
**Related**: ADR-074 (Remote Workspace Control Plane), ADR-065 (Farmhand Transparent Lifecycle),
ADR-057 (Task/Session Contracts), ADR-056 (Unified `refarm` Host Boundary),
`docs/local-disk-hygiene.md`, `@refarm.dev/health` (`environment-pressure`),
`scripts/ci/check-environment-substrate.mjs`, `validations/extension-sandbox-poc`, `.devcontainer/`,
`docs/decision-log.md`

---

## Context

The devcontainer is a **shared runtime** that hosts several coding-agent sessions (Codex, Claude
Code, Pi), the `refarm` CLI/runtime itself, and the project's own test/build suite. They must coexist
— space for all — without any single actor, **including refarm and its own suite**, destroying the
commons or compromising the very runtime it depends on to react.

ADR-074 already names this boundary rule: *"Environment ceilings are part of dispatch — a node can
refuse, serialize, or degrade work when memory, disk, sandbox, or host policy makes a lane unsafe."*
This ADR is the **local, kernel-enforced realization** of that rule inside one shared devcontainer,
ahead of the multi-machine control plane.

Refarm already has the **doctrine and the signals**, but as advisory contracts, not runtime
enforcement:

- `@refarm.dev/health` `environment-pressure` + `factory:pressure` return `continue` / `safe-mode` /
  `stop-and-investigate`, but `--strict` is optional and nothing forces a lane through the gate.
- `docs/local-disk-hygiene.md` documents bounded-worker discipline (e.g. `vitest run -- <pattern>`
  can fan workers out until the container stalls; use `--pool=forks --maxWorkers=1`) — as guidance.
- `scripts/ci/check-environment-substrate.mjs` composes ownership + node/rust substrate + pressure,
  but it is a **CI check**, not a boot-time guard.
- `workspace:source/artifacts:ownership` validate ownership after the fact; host writes still land as
  `root`.
- `validations/extension-sandbox-poc` enforces capability grants for **plugins/extensions**, not for
  the agent runtimes themselves.

### Triggering incident (2026-06-30)

A `pnpm` whose version did not match the `packageManager` pin recursed into self-installs
(`pnpm add pnpm@<v>` under `.tools/pnpm/<v>_tmp_*`): a fork storm of ~328 temporary installs that
consumed ~4 GB and stalled the container — the agent that launched it could not react. Earlier, a
`vitest` worker fan-out froze the same container. Both were *known and documented* hazards. None was
*prevented*. The advisory layer cannot stop an actor that does not opt in. (The specific pnpm hole is
closed by `manage-package-manager-versions=false`; this ADR addresses the class.)

## Decision

The **shared environment enforces ceilings at the runtime boundary; inhabitants do not self-police.**
Where the kernel enforces, the guarantee holds for every actor; where we only ask for discipline, we
are hoping. Seven principles:

1. **Environment enforces, inhabitants do not self-police.** Kernel-enforced ceilings (cgroup v2) are
   the non-bypassable backstop behind the advisory `factory:pressure` signal.
2. **Separate the control plane from the workload plane.** Agent and `refarm` runtimes live in a
   reserved, protected slice, distinct from the slice where the builds/tests/suites they launch run.
   A runaway workload fails loudly without taking down its controller or the commons.
3. **Space for all — fair share with floors.** `cpu.weight` (proportional share) plus `memory.min`
   floors per actor: idle, no one wastes; under contention, no one starves.
4. **No privileged citizen — including refarm.** The refarm suite is a workload; it runs in the
   workload slice under the same `pids`/`memory` ceilings. No runtime gets an exemption.
5. **Tooling must not self-mutate.** Package managers are pinned and self-install is disabled
   (`.npmrc manage-package-manager-versions=false`, done); the active toolchain is image/Corepack
   provisioned, not bootstrapped at call time.
6. **Identity at the boundary.** A single non-root user (1001) for every agent entrypoint, enforced
   at boot — so `workspace:*:ownership` becomes prevention, not a post-hoc check.
7. **Promote advisory to gate.** `factory:pressure` becomes a mandatory `--strict` gate for heavy
   lanes, behind a serialized heavy-lane lock, with bounded default workers.

### The four ceiling dimensions

| Dimension | Enforcement (kernel/boot) | Failure class it removes |
| --- | --- | --- |
| Resources | cgroup v2 `pids.max`, `memory.high`/`memory.max`, `cpu.weight`, `memory.min` | fork storms (pnpm self-install, vitest fan-out), OOM of the box |
| Identity | container/entrypoint user = 1001; no root writes | root/`nobody`-owned files that break others' git/writes |
| Git | per-agent worktree/branch; explicit-file staging, never `git add -A` | working-tree collisions between agents |
| Tooling | pinned package manager, self-install disabled, frozen toolchain | self-mutating tools recursing |

## Boundary

- This is **environment/runtime infrastructure** (`.devcontainer` + a health gate), not a published
  package. It operationalizes ADR-074's "environment ceilings" locally.
- It does **not** change agent SDK or task/session contracts; agents observe ceilings, they do not
  implement them.
- The commons watchdog and per-agent capability sandboxing reuse `@refarm.dev/health` and the
  `extension-sandbox-poc` capability model rather than introducing a new authority.

## Consequences

### Positive

- The commons survives any single actor's mistake — including refarm's own suite.
- A controller (agent/refarm runtime) survives the workloads it launches, because they live in a
  different slice. The agent can still react and kill a runaway instead of dying with it.
- Fork storms and worker fan-out are structurally contained by `pids.max`/`memory.max`, not by hope.
- Ownership conflicts disappear at the boundary instead of being hand-fixed with `chown`.

### Negative / Risks

- cgroup v2 delegation needs a container/devcontainer rebuild and a careful slice layout; this is not
  a live hot-patch.
- Per-agent slice assignment needs an entrypoint hook that places each session in its slice.
- Over-tight ceilings could throttle legitimate heavy builds. Mitigation: fair-share `cpu.weight` +
  `memory.min` floors and a checkpoint lane rather than hard caps for sanctioned heavy gates.
- Disabling pnpm self-management means the image must provision the pinned pnpm (Corepack); a drifted
  image would run a mismatched pnpm (compatible, but unpinned).

## Implementation (plan — phased, no live hot-patch)

1. **Tooling guard (done).** `.npmrc manage-package-manager-versions=false`; ensure the image
   provisions the pinned pnpm via Corepack.
2. **Config declaration (done).** `refarm.config.json` now owns the `environmentCeilings`
   declaration and `@refarm.dev/config/environment-ceilings` normalizes it. This keeps the ceiling
   policy product-neutral and lets `.devcontainer`, remote nodes, and future watchdogs consume the
   same source of truth.
3. **Slice layout in `.devcontainer`.** Define cgroup v2 slices — `control` (agent + refarm
   runtimes), `workload` (turbo/vitest/cargo/suite), and per-agent sub-slices — with `pids.max`,
   `memory.high`/`memory.max`, `cpu.weight`, `memory.min`, and `oom_score_adj` favoring killing
   workload over control. Delegate cgroup v2 at container start.
4. **Entrypoint placement.** A boot hook puts each agent session and the refarm runtime into its
   slice; heavy lanes run in the workload slice.
5. **Gate the heavy lanes.** Make `factory:pressure --strict` a precondition for heavy lanes, behind
   a `flock` serialized heavy-lane; set bounded default workers in `test-runner:contracts`.
6. **Identity at boot.** Force user 1001 for agent entrypoints; promote `workspace:*:ownership` from
   check to boot enforcement.
7. **Commons watchdog (v2, optional).** A small supervisor (reusing `@refarm.dev/health`) that kills
   the heaviest offending slice when global pressure is critical.
8. **Regression-test the guarantee.** Extend `scripts/ci/test-devcontainer-contract.mjs` from the
   current config-declaration assertion to active cgroup assertions once the rebuild lane lands —
   turning the existing contract-test pattern toward enforcement, so the guarantee cannot silently
   regress.
