# Base Surface Contract Extraction Design

**Status:** proposed design for the next implementation slice.

## Problem

The first daily-driver base slice added `refarm status --base --json` inside
`apps/refarm`. That was the right place to feel the pain quickly: the app is the
official daily driver, it already owns the operator CLI, and it could expose
runtime, model, health, evidence, and recovery handoffs immediately.

That code must not become the dependency path for other apps and examples.
T1/T2/T3, `apps/dev`, `apps/me`, future TUI/Web hosts, and headless/IOT hosts
should not import `apps/refarm`. They should compose the same operator truth from
neutral blocks, then organize and render it according to their own product shape.

The current app-local model is useful because it proved the boundary. It also
revealed two framework-level pains that were not example-specific:

- `@refarm.dev/storage-sqlite/node` had dist ESM specifiers that were invalid
  for Node runtime imports.
- base runtime sampling could be distorted when health ran in parallel with the
  sidecar probe, so runtime had to be sampled before slower base probes.

Those are exactly the kind of bottom-up discoveries the examples and first-party
apps should force. The next step is to prevent the incubated model from
solidifying as app code.

## Decision

Extract the pure base surface contract out of `apps/refarm` into a neutral core
package, while keeping app-specific sampling and CLI rendering in `apps/refarm`
for now.

The intended first package is:

- `@refarm.dev/operator-state`
- source path: `packages/operator-state`

This package should own the app-agnostic operator state vocabulary:

- units: runtime, model, health, tasks, sessions, plugins, and future domains
- state: ready, degraded, blocked, unavailable, unknown
- severity: info, warning, failure
- evidence: state, route, probe, command, path, count, timestamp
- actions: command-oriented recovery and manual alternatives
- handoffs: `nextAction`, `nextActions`, `nextCommand`, `nextCommands`
- pure model builders and format-independent normalization helpers

`apps/refarm` should remain a composition:

- collect runtime/model/health through existing app-local Node adapters
- call the package model builder
- render CLI text or JSON
- own command wiring, Commander options, chalk output, and operator help text

Downstream consumers should import only the neutral package at first. They
should not import `apps/refarm`, and they should not depend on Refarm CLI command
files for state semantics.

## Alternatives Considered

### A. Leave the model in `apps/refarm` until T1/T2/T3 need it

This keeps the next slice tiny, but it makes the app-local shape look official.
The first downstream consumer would either copy the model or import the app. Both
paths make later extraction more expensive and encourage presentation drift.

### B. Extract only the pure model now

This is the recommended path. It moves the stable vocabulary and normalization
rules without moving Node, runtime, health, CLI, chalk, Commander, filesystem, or
sidecar dependencies. The package becomes reusable immediately, and adapters can
continue to mature where the pain is concrete.

### C. Extract model, Node adapters, and renderers now

This is attractive because it makes the package feel complete, but it is too
broad for the next slice. The Node adapters still encode app-specific knowledge:
runtime command deps, model credential loading, and health policy behavior. Those
should be promoted only after at least one more host needs them.

## Boundaries

### `@refarm.dev/operator-state`

Allowed:

- TypeScript types for operator units, evidence, actions, and handoffs.
- Pure model builders.
- Pure normalization helpers.
- JSON-safe structures.
- Tests that pass without filesystem, runtime, HTTP, SQLite, or CLI bootstraps.

Forbidden:

- `apps/refarm` imports.
- Commander, chalk, process exit behavior, filesystem reads, sidecar calls, or
  runtime bootstrapping.
- Direct dependency on Tractor, Farmhand, SQLite, model credentials, or health
  auditors.
- Example-specific domain copy or renderers.

### `apps/refarm`

Allowed:

- CLI command ownership.
- app-local sampling of runtime/model/health.
- human output and command help.
- mapping existing Refarm command payloads into `@refarm.dev/operator-state`.

Forbidden:

- becoming the public contract for other apps.
- exporting app command files as reusable SDK surface.
- adding example-specific concepts to make T1/T2/T3 look better.

### Future adapter packages

If repeated use proves the boundary, promote adapters separately:

- `@refarm.dev/operator-state-node` for Node/local workspace probes.
- `@refarm.dev/operator-state-sidecar` for HTTP/sidecar sampling.
- `@refarm.dev/operator-state-renderers` only if multiple surfaces need shared
  text or compact render helpers.

Those packages are intentionally not part of the first extraction.

## Data Flow

Current after extraction:

1. `apps/refarm` samples runtime/model/health.
2. `apps/refarm` maps those payloads into neutral input objects.
3. `@refarm.dev/operator-state` builds the normalized operator model.
4. `apps/refarm` renders JSON or human CLI output.

Future consumers:

1. A host app or example chooses its own sampler.
2. It feeds neutral inputs into `@refarm.dev/operator-state`.
3. It renders the same model as CLI, TUI, Web, HTTP, or domain UI.
4. Domain extensions add units/actions/evidence through the same model instead
   of importing Refarm app code.

The key invariant: different apps may organize the experience differently, but
they must not invent different meanings for the same base condition.

## Extension Model

The base model should be open to additional units, not limited to the first
`runtime`, `model`, and `health` units. T1/T2/T3 should be able to add domain
units such as "wallet verification", "source ingestion", or "review queue"
without changing the base package.

That extension should happen through data:

- stable unit ids
- owner/source metadata
- evidence records
- action records
- severity/state normalization

The extension should not require subclassing app code or importing Refarm CLI
commands.

## Distribution Implications

This design does not decide how `refarm` is distributed. It makes that decision
less coupled.

Possible distributions remain viable:

- `refarm` as a bundled CLI/app.
- `refarm` with optional Tractor/Farmhand runtime acquisition.
- headless host that talks to an existing sidecar.
- IOT/local host that only uses a subset of operator-state blocks.
- TUI/Web hosts that render the same model with different density.

The extraction ensures the app can be bundled or decomposed later without making
other consumers depend on the bundle internals.

## Testing Strategy

The first implementation slice should be small:

1. Create `packages/operator-state`.
2. Move the pure model types and builders from
   `apps/refarm/src/commands/base-surface-model.ts`.
3. Preserve the current behavior of `refarm status --base --json`.
4. Keep runtime/model/health sampling in `apps/refarm`.
5. Add package-level tests proving the model has no app/runtime dependencies.
6. Add app tests proving `apps/refarm` consumes the package instead of app-local
   model code.

Validation should include:

- package tests for `@refarm.dev/operator-state`
- focused `apps/refarm` status/base tests
- type-check and build for both packages
- `refarm tidy imports --check --json`
- manual `node apps/refarm/dist/index.js status --base --json`

## Acceptance Criteria

- No downstream package or example needs to import `apps/refarm` to use the base
  operator state model.
- `apps/refarm/src/commands/base-surface-model.ts` is removed or reduced to a
  local adapter/re-export with no ownership of the core vocabulary.
- `@refarm.dev/operator-state` has no runtime, filesystem, CLI, app, Tractor, or
  Farmhand dependency.
- `refarm status --base --json` output remains compatible with the current
  daily-driver walkthrough.
- The design leaves adapter extraction for a later slice, after repeated use
  proves the boundary.

## Non-goals

- No T1/T2/T3 domain implementation in this slice.
- No TUI/Web renderer work in this slice.
- No distribution or installer decision.
- No broad rewrite of `apps/refarm`.
- No migration of runtime/model/health sampling into packages before another
  consumer proves the adapter boundary.

## Follow-up Slices

1. Extract `@refarm.dev/operator-state`.
2. Add one non-Refarm consumer test or fixture that builds a custom model unit
   without importing `apps/refarm`.
3. Decide whether `apps/dev`, `apps/me`, or one T example should be the first
   downstream consumer.
4. Promote Node/sidecar adapters only after two consumers need the same sampler.
