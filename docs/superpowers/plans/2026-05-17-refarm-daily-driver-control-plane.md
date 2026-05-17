# Refarm Daily Driver Control Plane — Convergence Plan

> **For agentic workers:** This is a strategic convergence plan. Do not treat it
> as permission for broad rewrites. Implement in small slices, keep existing
> source/artifact boundaries, and update related docs whenever a slice changes
> the intended direction.

**Goal:** Make Refarm a robust daily driver before any real `v0.1.0`
publication: personal and work operations, local/remote Farmhand control,
verified plugins, resumable efforts, and one shared control surface usable from
TUI or PWA.

**Thesis:** Farmhand is the control plane. TUI, PWA, `pi-agent`, and scripts are
clients. Plugins are capability packages. Migration packs are a plugin/package
profile for safe evolution. Publication waits until this loop survives real use.

**Primary constraint:** Avoid freezing unstable contracts that would force an
immediate v2 after publication. Stabilize the minimal contracts through daily
use before publishing packages as ecosystem commitments.

---

## North Star

From machine A, the user can control machine B through Farmhand:

1. pair or authorize the machine explicitly;
2. submit an effort to a verified plugin;
3. stream progress and logs;
4. cancel or retry safely;
5. inspect evidence after completion;
6. update, disable, revoke, or migrate the plugin without corrupting durable
   state;
7. perform the same workflow from a TUI first and a PWA later.

If this works reliably for personal and work routines, Refarm earns `v0.1.0`.

---

## Non-Goals

- Public marketplace.
- Polished PWA UX.
- Broad registry redesign.
- Unrestricted remote shell.
- Freezing every v1 contract before lived use.
- Replacing the existing plugin/package model with a separate migration system.

---

## Work Lane A: Contract Stabilization

**Purpose:** Identify the smallest contract set that must survive publication
without immediate replacement.

- [ ] Inventory the current stability of `Effort`, `Task`, `Session`, and stream
      contracts.
- [ ] Define the minimum event/evidence envelope needed by TUI, PWA, logs, and
      agent reports.
- [ ] Review `plugin.json` for extension, skill, asset, and migration-pack
      roles without creating a parallel package system.
- [ ] Mark fields as `stable`, `experimental`, or `internal` where ambiguity
      would otherwise create accidental API commitments.
- [ ] Document versioning and migration expectations for CRDT data, lenses,
      plugin-owned schemas, and package manifests.

**Done signal:** a contributor can tell which contracts are safe to consume,
which are still internal, and how a breaking change would be migrated.

---

## Work Lane B: Farmhand Remote Control Plane

**Purpose:** Make Farmhand the reliable execution and coordination daemon for
local and remote machines.

- [ ] Define local-vs-remote Farmhand topology: device identity, pairing,
      authorization, transport, and trust boundary.
- [ ] Keep remote execution capability-based. Do not expose a generic remote
      shell as the primary interface.
- [ ] Support effort submission, stream following, cancellation, retry, and
      status summary through stable endpoints.
- [ ] Persist enough run metadata for restart/reconnect recovery.
- [ ] Produce audit/evidence records that can be consumed by agents and humans.
- [ ] Add scoped health checks for remote readiness.

**Done signal:** one trusted machine can submit, monitor, cancel, and inspect a
real effort running on another machine without SSH-like implicit authority.

---

## Work Lane C: Plugin Safety and Lifecycle

**Purpose:** Make plugins safe enough to become the unit of extension,
automation, and future distribution.

- [ ] Route Farmhand plugin install/load through the shared Barn/install
      contract instead of raw filesystem assumptions.
- [ ] Require integrity verification for WASM artifacts.
- [ ] Preserve JS plugin onboarding while making WASM the hardening path.
- [ ] Add plugin disable/revoke/update semantics that are visible from the
      control surface.
- [ ] Introduce Scarecrow observation hooks where plugin capabilities cross WIT
      or host boundaries.
- [ ] Treat migration packs as a plugin/package profile: deterministic changes,
      fixtures, dry-run/evidence, validation, and policy gates.

**Done signal:** a plugin can be installed, verified, used, observed, disabled,
updated, and migrated through the same operational model.

---

## Work Lane D: Daily-Driver Surfaces

**Purpose:** Build surfaces that reveal operational gaps quickly without making
UI the source of semantics.

- [ ] Keep `refarm chat` daily-driver work aligned with the existing Farmhand
      daily-driver spec.
- [ ] Prioritize TUI as the first durable operator surface: machines, efforts,
      plugins, streams, logs, evidence, health.
- [ ] Let PWA consume the same contracts after the control plane is usable.
- [ ] Ensure Web/TUI/headless actions share the existing host action envelope.
- [ ] Keep product-specific action meaning in apps, not reusable packages.

**Done signal:** the user can operate Refarm for real work from the terminal,
with PWA following the same contracts rather than inventing separate behavior.

---

## Work Lane E: pi-agent and Structural Tooling

**Purpose:** Make agents safer and more reusable by giving them structural
perception and migration disciplines.

- [ ] Preserve `pi-agent` as a Farmhand/Tractor-executed capability, not a
      privileged backdoor.
- [ ] Add or plan AST/structured-data inspection tools before broad write tools.
- [ ] Prefer deterministic transforms for repeated edits; reserve AI for
      residual semantic work.
- [ ] Let agents propose migration packs when they discover repeatable
      mechanical changes.
- [ ] Require evidence output for agent-run migrations and remote efforts.

**Done signal:** agent work produces reusable operational knowledge instead of
one-off chat context.

---

## Knowledge Alignment Lane

**Purpose:** Prevent strategic drift. When this plan becomes the convergence
lane, related knowledge artifacts must either point to it or explicitly state
their narrower scope.

This is not limited to `docs/`. In Refarm, durable project knowledge also lives
in the root `README.md`, package READMEs, app READMEs, ADRs, feature specs,
roadmaps, `.project` state, AGENTS-style instructions, examples, templates, and
source-adjacent docs.

### Artifacts to align first

| Document | Required alignment |
|---|---|
| `README.md` | Keep the project-facing narrative aligned with Farmhand-as-control-plane and publication restraint. |
| `docs/INDEX.md` | Add this plan as the daily-driver/control-plane convergence entry. |
| `docs/v0.1.0-release-gate.md` | Make Farmhand control-plane readiness the active daily-driver interpretation. |
| `docs/DAILY_DRIVER_PARITY.md` | Add remote Farmhand, plugin lifecycle, evidence, and TUI/PWA client parity rows. |
| `docs/superpowers/specs/2026-05-14-farmhand-daily-driver.md` | Mark as tactical `refarm chat`/REPL slice under this broader plan. |
| `docs/superpowers/specs/2026-05-13-barn-scarecrow-evolution.md` | Link plugin lifecycle work to the control-plane lane. |
| `docs/superpowers/specs/2026-05-14-pi-refarm-interop.md` | Align `pi-agent` interoperability with Farmhand-as-control-plane. |
| `docs/research/codemod-strategic-assessment.md` | Keep migration-pack language tied to plugin/package profiles. |
| `docs/REFARM_HOST_RUNTIME_ACTION_ROUTING.md` | Ensure TUI/PWA/headless remain clients of shared action envelopes. |
| `docs/REFARM_PERSONAL_DAILY_DRIVER.md` | Reconcile personal daily-driver narrative with remote control-plane criteria. |
| `roadmaps/MAIN.md` | Point near-term roadmap at this convergence lane if still current. |
| `packages/*/README.md` | Update only when package-facing claims conflict with the control-plane direction. |
| `apps/*/README.md` | Clarify whether each app is a control-plane client, distro, daemon, or experiment. |
| `specs/ADRs/*` | Add superseding/context links when ADR interpretation changes; do not rewrite accepted history. |
| `specs/features/*` | Align active feature specs with Farmhand-as-control-plane when relevant. |
| `.project/*.json` | Keep active tasks/decisions/handoff aligned if this lane becomes current work. |
| `AGENTS.md` and nested agent instructions | Update only if operating rules need to change, not for ordinary plan references. |
| templates/examples | Update when generated guidance would teach stale architecture. |

### Alignment rules

- [ ] Alignment does not mean repeating this plan everywhere. Preserve each
      artifact's audience, tone, and scope; change only what would otherwise
      mislead a reader or future agent.
- [ ] Prefer the smallest correction: update a status sentence, add one pointer,
      qualify an outdated claim, or record a follow-up. Do not turn READMEs,
      package docs, or feature specs into copies of this plan.
- [ ] Every durable artifact that mentions `v0.1.0` must say publication is
      gated by daily use and control-plane confidence, not contract readiness
      alone.
- [ ] Every durable artifact that talks about plugins must distinguish runtime
      extension, skill/asset payloads, and migration-pack profile.
- [ ] Every durable artifact that talks about UI must describe TUI/PWA/headless
      as clients of shared contracts, not owners of runtime semantics.
- [ ] Every durable artifact that talks about remote execution must reject
      generic remote shell as the default abstraction.
- [ ] When a slice changes direction, update the closest source-of-truth
      artifact in the same commit or explicitly add a follow-up task here.
- [ ] Preserve historical ADRs/specs as records. Prefer forward links,
      "superseded by", or "interpreted by" notes over rewriting history.
- [ ] Respect existing accurate wording. If an artifact already communicates
      the right direction at the right level of detail, leave it alone or add
      only a narrow reference.

**Done signal:** a new agent can read the root README, indexes, release gate,
parity checklist, active specs, package/app READMEs, and project state without
getting conflicting priorities.

---

## Suggested Execution Order

1. Align docs around this plan enough to prevent drift.
2. Finish the tactical `refarm chat` daily-driver gaps that make Farmhand usable
   locally.
3. Route Farmhand plugin lifecycle through Barn/install contracts.
4. Define the minimum remote-control trust model and implement a local-first
   loop before exposing remote machines broadly.
5. Add TUI operator views over existing endpoints and event streams.
6. Add plugin disable/revoke/update paths and Scarecrow observation.
7. Practice migration-pack discipline through scaffold/conformance, then plugin
   manifests, CRDT lenses, and schemas.
8. Promote the PWA once the control plane semantics are proven by TUI and daily
   use.

---

## Validation Economy

Use the smallest signal that proves the slice:

- docs-only: `git diff --check`;
- TypeScript packages: scoped `pnpm --filter @refarm.dev/<pkg> run type-check`
  or `build`;
- apps: focused app tests before broader gates;
- Rust: filtered `cargo test --lib <filter>` or package-specific checks;
- remote/control-plane: one explicit manual acceptance script before broad CI.

Do not use CI as the first test runner for behavior that can be reproduced
locally.

---

## Done Criteria

- The documentation set points to this plan as the daily-driver convergence
  lane.
- Farmhand can be started, inspected, and used locally as the default execution
  control plane.
- A remote Farmhand can execute a verified effort with stream, cancel, retry,
  and evidence.
- Plugin install/load/update/revoke flows use shared integrity-aware lifecycle
  contracts.
- TUI can operate machines, efforts, plugins, logs, and evidence without owning
  runtime semantics.
- PWA can follow the same contracts when promoted.
- At least one migration-pack candidate has been exercised on a low-risk
  internal maintenance task.
- `v0.1.0` remains unpublished until this loop has survived real personal and
  work use.
