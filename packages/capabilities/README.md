# @refarm.dev/capabilities

The Refarm **capability model** — the neutral core that a capability is declared
against, and the axis it projects along. Extracted from `@refarm.dev/cli` (which
is process/CLI primitives): the capability core was never "CLI", and living
inside a package named `cli` mislabelled the most central concept in the system.

## What lives here

- **`registry.ts` / `types.ts`** — the `CapabilityDescriptor` and
  `CapabilityRegistry`: a capability is declared **once** here.
- **`surface-model.ts`** — the **open surface-projection axis** (ADR-085).
  `SurfaceItem.surfaces` is `Record<string, SurfaceHint>`: a new surface
  (`webxr`, `voice`, `game`, `terminal`) is data, not a hardcoded field, so it
  flows end-to-end with zero core edits. `gatherSurfaces` is the one place
  surface keys are read from a descriptor.
- **The projectors** — `cli` / `http` / `agent` / `openapi` / `palette`. Each is
  a blind loop over the registry filtering a bucket; adding a surface means
  registering a projector, not editing verbs.
- **`envelope.ts`** — the neutral result envelope (`printJson`, `formatJson`,
  `JsonSuccessEnvelope`, `JsonErrorEnvelope`). A JSON envelope is surface-neutral
  (web/agent/http read it the same); the shell-quoting handoff helpers that are
  genuinely CLI stay in `@refarm.dev/cli`.

## What does NOT live here

Process/CLI primitives — `command-handoff` (shell quoting), `process-handoff`,
`git-command`, `launch-policy`, `browser-open` — remain in `@refarm.dev/cli`.
This package is a **leaf**: it depends only on `chalk` + `commander`, never on
`cli`, so the direction is clean (implementations depend on the model, not the
reverse).

## Relationship to `@refarm.dev/capabilities-v1`

`capabilities-v1` is the layer of **implementations** (source / records / vault /
plugin-bridge) built *on* this model. Reads as: `capabilities-v1` extends
`capabilities`.
