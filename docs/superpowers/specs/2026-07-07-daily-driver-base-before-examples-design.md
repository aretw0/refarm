# Daily-Driver Base Before Example Pressure Design

**Status:** design approved 2026-07-07. This is a design/specification
document, not an implementation patch.

## Problem

The T1, T2, and T3 examples are intended to be pressure engines for Refarm:
they should force the platform to expose extension, multi-surface, and WASM
pain instead of hiding that pain behind example-specific code.

The ordering matters. If the examples move onto a shared infrastructure before
Refarm's own base experience is coherent, each example can accidentally become
a compensating layer for missing platform behavior. That would make the demos
look better while making the framework less honest.

Before T1/T2/T3 become the main judges, Refarm itself should be judged as a
zero-extension daily driver: a user should be able to use the `refarm` CLI and
its first-party surfaces without adding plugins, importing the SDK, or relying
on a white-label app to make the experience feel complete.

## Decision

The lane is ordered in two stages:

1. **Base first:** harden what Refarm delivers by itself as a daily-driver
   operator environment.
2. **Examples second:** use T1/T2/T3 as downstream consumers that stress
   extension, domain, WASM, and richer manual exploration only after the base
   contract is coherent.

The examples remain central, but they become judges of a real platform base
instead of substitutes for that base.

## What "zero-extension daily driver" means

Zero-extension does not mean no runtime, no first-party packages, or no agent.
It means the user does not need to write a plugin, consume Refarm as an SDK, or
open a purpose-built example app to understand and use the core environment.

At minimum, the base experience should cover:

- session resume and handoff visibility
- workspace and runtime readiness
- health diagnostics and concrete recovery commands
- model and credential state
- task/effort visibility
- agent access or a deterministic reason it is unavailable
- plugin/runtime visibility without requiring a third-party plugin
- consistent CLI, TUI, Web/HTTP, and app-facing semantics where those surfaces
  exist

The base should be compact by default and progressively detailed on demand. The
lesson from Pi/agents-lab-style TUI work applies here: the control plane should
be visible and actionable without becoming noisy, and the same state should not
be renamed differently on each surface.

## Current evidence

The repository already contains most ingredients, but they are not yet judged
as one cohesive base product.

- `@refarm.dev/capabilities-v1` has neutral blocks such as `surfaceModel`,
  `runTui`, `serveWebUi`, CLI command projection, HTTP handlers, plugin bridge,
  and WASM provider adapters.
- `apps/refarm` still has first-party command surfaces and registry projection
  that can drift from the generic capability surface.
- `apps/dev` and `apps/me` are documented as daily-driver surfaces, but they
  should be promoted only through the same base acceptance loop.
- T1/T2/T3 currently build and test, and their CLIs demonstrate the domain
  intent, but their manual path is still too JSON/endpoint-heavy to be the
  final exploratory experience.
- The current operator loop exposes base issues before examples are involved:
  `refarm check --next-action --json` reports runtime not ready, and health
  policy suggests explicit treatment for ignored generated plugin source files.
  The CLI also reports Silo OAuth credentials while the local sidecar is not
  reachable, so credential/runtime handoff needs to be understandable from the
  base experience itself.

These are not example problems. They are base daily-driver problems.

## Base surface contract

The hardening target is a single conceptual surface model that can be rendered
through different first-party adapters:

- human CLI
- CLI JSON handoff
- TUI
- Web/HTTP surface
- `apps/dev` and `apps/me` where applicable
- examples once they move downstream

The model should carry stable fields rather than presentation-only text:

- identity: stable id, label, owner, source package
- state: ready, degraded, blocked, unavailable, unknown
- severity: info, warning, failure
- summary: short human-readable status
- evidence: command output, probe result, file path, route, or timestamp
- actions: primary recovery command, optional next commands, manual alternatives
- details: structured metadata for richer surfaces

The same condition should have the same meaning everywhere. For example,
`runtime:not-ready` should not be translated into three different concepts in
CLI, TUI, and Web. Surfaces may choose different density, but not different
truth.

## Base hardening targets

### 1. Inventory the daily-driver loop

Build a concrete map of what a user does when using Refarm directly:

1. starts or resumes work
2. checks whether the workspace/runtime is usable
3. sees what session/task state exists
4. asks the agent or learns why it cannot answer
5. opens a richer surface only when it adds operational value
6. recovers from runtime, credential, health, or plugin-state failure
7. leaves behind handoff state that can be resumed later

The inventory should classify each action as base, extension, example, or app.
Anything required for daily use belongs in base.

### 2. Make runtime failure a first-class base state

Runtime not ready is not an exceptional afterthought. It is a common daily-driver
state and must produce clear recovery:

- what was probed
- why it failed
- whether credentials are present
- whether the sidecar is reachable
- which command should be run next
- what can still be used while the runtime is down

The current mismatch between CLI credential visibility and sidecar readiness is
exactly the kind of state the base surface must explain.

### 3. Consolidate surface semantics before polishing examples

The design goal is not to make every renderer identical. It is to ensure they
render the same state model. TUI can be denser, Web can be more navigable, JSON
can be machine-stable, and CLI can be terse, but they should all derive from the
same underlying base concepts.

Where `apps/refarm` and `@refarm.dev/capabilities-v1` project similar concepts
in parallel, implementation should prefer convergence through shared source
models over copying presentation code between surfaces.

### 4. Define a manual exploratory acceptance path

Tests are necessary, but the base must also support the user's manual recording
workflow. The acceptance path should be a real operator walkthrough, not a demo
page:

- run the resume/check/status loop
- inspect model/runtime/health state
- inspect sessions/tasks/history where available
- submit or simulate an agent turn, or see deterministic unavailable guidance
- open the richer first-party surface when it exists
- run the same recovery commands suggested by JSON handoffs
- verify that restarting the shell does not erase the story

This path should become the base packet used before recording T1/T2/T3.

## How T1/T2/T3 fit after base hardening

Once the base is coherent, each example should extend it in a different way:

- **T1 / Devbench:** stresses extension authoring, coding-agent ergonomics,
  review/code verbs, and the ability to expose a developer workflow without
  custom platform scaffolding.
- **T2 / Wallet:** stresses result-oriented citizen UX, local-first records,
  verification states, and a manual surface suitable for inspection and
  recording.
- **T3 / Reqbench:** stresses analyst workflows, source ingestion, enrichment,
  RCDC5-style material, MOC generation, and WASM-backed providers.

Examples may add domain verbs, fixtures, renderers, and domain-specific copy.
They should not add missing runtime readiness, handoff, task visibility, or
surface semantics that belong to base Refarm.

## Testing and verification strategy

Implementation planning should decompose this spec into small slices. The
validation stack should grow in this order:

1. base surface-model tests for state normalization and actions
2. CLI JSON contract tests for `resume`, `check`, `status`, runtime, health, and
   model state
3. renderer tests for TUI/Web/HTTP parity over the same model
4. manual daily-driver walkthrough using zero-extension Refarm
5. example tests and builds after the base model is stable
6. manual exploratory walkthroughs for T1/T2/T3
7. WASM/runtime integration only when the base and example need it for a real
   acceptance path

The current example tests remain useful regression signals, but they should not
be treated as proof that the base daily-driver experience is ready.

## Non-goals

- No browser-only presentation mockup as a substitute for project behavior.
- No example-specific scaffolding to hide missing base features.
- No WASM extension work before the base exposes the need clearly.
- No release/publication decision in this lane.
- No broad rewrite of all surfaces in one change.

## Sequencing

### Slice A - Base inventory and gap map

Document the first-party daily-driver commands, surfaces, and state producers.
Classify each as base, app, extension, or example. Record the known gaps shown
by the current `refarm resume` / `refarm check` loop.

### Slice B - Base surface contract

Define or adapt the shared state model used by first-party surfaces. Prefer
structured state and recovery actions over renderer-specific strings.

### Slice C - Runtime and health hardening

Make runtime readiness, credential state, sidecar reachability, health policy,
and recovery commands understandable from the zero-extension base path.

### Slice D - Multi-surface parity

Align CLI JSON, human CLI, TUI, Web/HTTP, and app-facing surfaces around the
same model. Keep renderers surface-appropriate, but make their semantics
testably equivalent.

### Slice E - Examples as downstream judges

Move T1/T2/T3 onto the hardened base surface. Add only domain-specific verbs,
renderers, fixtures, and manual exploratory scripts. Use the examples to expose
extension and WASM pain that the base should not pre-solve prematurely.

## Definition of done

This lane is ready to move from design to implementation planning when the
following target is accepted:

1. Refarm has a documented zero-extension daily-driver walkthrough.
2. Runtime/credential/health failures produce deterministic, actionable base
   states.
3. CLI, JSON, TUI, Web/HTTP, and app-facing surfaces share the same base
   semantics where they overlap.
4. T1/T2/T3 are explicitly downstream consumers and do not compensate for base
   surface gaps.
5. Automated tests and manual exploratory scripts both exist in the eventual
   implementation plan.

## Related context

- `docs/DAILY_DRIVER_PARITY.md`
- `docs/REFARM_PERSONAL_DAILY_DRIVER.md`
- `docs/UI_ARCHITECTURE.md`
- `docs/POC_DEMONSTRATION_PACKET.md`
- `docs/POC_VALIDATION_PRESSURE.md`
- `docs/superpowers/specs/2026-05-14-farmhand-daily-driver.md`
- `docs/superpowers/specs/2026-06-17-dispatch-control-plane-contract.md`
- `examples/devbench-t1/README.md`
- `examples/wallet-t2/README.md`
- `examples/reqbench-t3/README.md`
