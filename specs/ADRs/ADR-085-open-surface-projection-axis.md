# ADR-085: The Open Surface Projection Axis — Surfaces as Data, Projectors as Plugins

**Status**: Proposed
**Date**: 2026-07-09
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-016 (Headless UI Contract — the sibling axis: HOW a component
behaves/themes, vs. this ADR's WHERE a verb projects), ADR-083 (Canonical Plugin
WIT Contract), ADR-084 (Plugin Dispatch Model), `docs/EXTENSIBILITY_MODEL.md`
(canonical surfaces), `packages/cli` (capability projectors),
`packages/capabilities-v1` (surfaceModel), `packages/homestead` (surface slots),
`packages/plugin-manifest` (ExtensionSurfaceDeclaration)

---

## Context

A refarm capability declares, in ONE place, how it reaches every surface:

- `transports` (`cli` / `repl` / `http` / `agent`) — **how a verb is invoked** (the
  channel).
- `renderers` (`web` / `tui`) — **how a verb is presented** (the projection).

These two axes are correct and orthogonal: `http` (invocable over the network) is
not `web` (shown in a browser UI). A verb can carry `http` without `web` (a pure
API) or `web` without `http` (a UI dispatched by another channel).

Two facts forced this ADR:

1. **The axis is open in the type, closed in the code.** `CapabilityTransports`
   and `CapabilityRenderers` both end with `[key: string]: unknown` — the type
   admits any surface. `docs/EXTENSIBILITY_MODEL.md` already commits to it: "one
   manifest, many surfaces" and "the wire type is deliberately an open JSON-LD
   string… that openness IS the extensibility." **But every projector hardcodes
   its field**: `cli-projector` reads `transports.cli`, `http-projector` reads
   `transports.http`, `surfaceModel` reads `renderers.web`/`renderers.tui`. No
   projector iterates the axis. A new surface — WebXR, voice, an AR HUD, a game
   overlay — is impossible to project without editing projector code by hand.

2. **The vision is an engine, not a fixed UI set.** The goal is a base broad
   enough to grow "almost a game engine inside refarm" — arbitrary systems on
   arbitrary surfaces. A base that enumerates `web?`/`tui?` as fixed fields caps
   that vision at the surfaces someone thought of first.

There is also a **two-level naming collision** to reconcile:

- **Extension surface layers** (`homestead` / `asset` / `automation` / `desktop`
  / `pi` / `tractor`, from `docs/EXTENSIBILITY_MODEL.md` and
  `ExtensionSurfaceDeclaration`) — WHERE a plugin mounts (manifest-level; what the
  homestead shell consumes into DOM slots).
- **Verb renderers/transports** (`web` / `tui` / `http` / `cli` / `agent`) — HOW a
  single verb projects (descriptor-level).

An engine surface (WebXR/game) is a new *renderer* (verb-level) that paints into a
*surface layer* (extension-level). Both levels are the SAME axis at different
granularities, and both must be open.

## Decision

**A surface is data, not a type field. Each surface is projected by a registered
SurfaceProjector, and adding a surface means registering a projector — never
editing a verb or another projector.**

### 1. Surfaces are keys, hints are open records

`renderers` and `transports` stay open maps keyed by surface id. A renderer/
transport hint is an open record the projector for that surface interprets. The
named fields (`web`, `tui`, `http`, `cli`, `agent`) become the *canonical initial
entries* of an open set, not an exhaustive union.

```ts
// A verb declares any surface; the projector for that key knows what the hints mean.
renderers: {
  web:   { route: "/settings", icon: "gear" },
  tui:   { section: "config", shortcut: "ctrl+m" },
  webxr: { anchor: "left-panel", mesh: "settings.glb" },   // a new surface, no core edit
}
```

### 2. A SurfaceProjector registry replaces the hardcoded projectors

A projector declares which bucket it reads and how it projects. The existing
`cli`/`http`/`agent`/`openapi`/`web`/`tui` projectors become *registered*
projectors over the open axis, not bespoke functions each re-reading the registry
with its own rule.

```ts
interface SurfaceProjector<Projection> {
  surface: string;                 // "cli" | "http" | "web" | "tui" | "webxr" | …
  axis: "renderers" | "transports";
  reads(entry: CapabilityEntry): unknown | undefined;   // the verb's hint for this surface
  project(verbs: ProjectedVerb[]): Projection;          // the surface-specific output
}
registerSurfaceProjector(webXrProjector);   // adding a surface = one registration
```

The neutral `surfaceModel` becomes a *projection over a chosen surface key*
(`projectSurface(registry, "tui")`), so the TUI and web reads that had diverged
(`surfaceModel` = web-or-tui, `capabilityTuiSections` = tui-only) collapse into
one blind reader parameterized by surface — killing the duplication that started
this investigation.

### 3. The two levels bridge through the axis, not a second model

A verb's `renderers.<surface>` and a plugin's `extensions.surfaces[]`
(`ExtensionSurfaceDeclaration`) name the SAME surface vocabulary. The homestead
layer is one registered surface projector whose `project()` emits the
`ExtensionSurfaceDeclaration`/slot mount homestead already consumes — so "declare
a verb once → it appears in the homestead web" is a projector, not a bespoke
bridge. (This is the follow-on left open when `serveWebUi` was removed in
`c76bb822`.)

### 4. Capability-scoped, per ADR-083/EXTENSIBILITY_MODEL

A surface projector runs under the host's capability grants: a WebXR projector
that reaches a headset, a desktop projector that touches the tray, each is
authorized per declared capability — "entry format alone is not a trust model."
Projecting a hint stays inert data; only `run()` executes.

## Consequences

**Enables**
- New surfaces (WebXR, voice, game-HUD, AR) as registered projectors — the engine
  vision, with zero edits to existing verbs or projectors.
- One blind reader per surface (no duplicated section-grouping logic).
- The homestead web bridge as a projector, closing the `serveWebUi`-removal
  follow-on.

**Costs / risks**
- Refactor of `packages/cli/src/capabilities` (the projector home) — the canonical
  projectors move behind the registry. Blast radius: every projector consumer.
- The open axis loses compile-time exhaustiveness on surface keys; a projector for
  an unknown key is a no-op (inert), which is the intended openness but must be
  observable (log unprojected surfaces, don't swallow silently).
- Two-level bridge (verb renderers ↔ extension surfaces) needs a shared surface-id
  vocabulary; drift there reintroduces the very fragmentation this closes.

## Alternatives considered

- **Keep hardcoded fields, add each surface by hand.** Rejected: caps the engine
  vision at pre-imagined surfaces; every new surface edits core.
- **A single mega-model that enumerates all surfaces.** Rejected: same closed
  union, larger; the openness must be in the axis, not a bigger fixed shape.
- **Leave `[key:string]:unknown` as the only openness.** Rejected: open in the
  type but closed in the code is the current bug — no projector uses it.

## Rollout (phased, not one commit)

1. `surfaceModel` becomes surface-parameterized (`projectSurface(registry, key)`);
   `capabilityTuiSections` derives from it (kills the duplication) — behavior
   identical, tested.
2. Introduce the `SurfaceProjector` registry; re-register cli/http/agent/openapi/
   web/tui behind it — behavior identical.
3. Add the homestead projector (verb → `ExtensionSurfaceDeclaration`), closing the
   web bridge.
4. Prove the axis open: a reference engine surface (a minimal WebXR or game-HUD
   projector) added with ZERO edits to existing verbs — the daily-driver proof
   `EXTENSIBILITY_MODEL.md` demands before a surface is promoted.
