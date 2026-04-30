# Refarm Extensibility Model

Refarm should unlock extension without locking the ecosystem into one runtime. The long-term model is **multi-surface, capability-scoped, and promotion-gated**: start with the least-friction plugin shape that solves a real daily-driver need, then harden only the surfaces that earn production use.

## Principles

1. **One manifest, many surfaces** — a plugin may expose headless runtime behavior, UI slots, automations, local scripts, assets, or desktop integrations under one identity.
2. **Schema-neutral transport** — sync layers move graph updates; they do not special-case plugin kinds, stream nodes, or UI widgets.
3. **Capability-first security** — hosts authorize declared capabilities per surface; entry format alone is not a trust model.
4. **Progressive hardening** — JS is acceptable for L0/L1 onboarding; WASM and stronger provenance become the L2/L3 path for sensitive or shared plugins.
5. **Daily-driver proof before ecosystem promise** — an extension surface is promoted only after it survives the creator's real workflow.

## Canonical surfaces

| Surface      | Host                            | Typical use                                                     | Promotion signal                                         |
| ------------ | ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `tractor`    | native/headless daemon          | storage adapters, indexers, agent/tool bridges, background work | passes scoped runtime tests and survives daemon restart  |
| `homestead`  | browser shell / `apps/dev` Studio | panels, widgets, editors, stream renderers                    | mounts in real DOM slots and reconnects after reload     |
| `pi`         | local automaton / agent harness | filesystem tools, local scripts, reminders, hardware hooks      | host-authorized, auditable, and recoverable from handoff |
| `automation` | Windmill/workflow layer         | scheduled tasks, macros, recurring operations                   | ownership and retry semantics are explicit               |
| `desktop`    | native/OS integration           | file watchers, tray/menu actions, platform affordances          | isolated permissions and rollback path exist             |
| `asset`      | cache/CDN/OPFS                  | themes, templates, dictionaries, model files                    | integrity checked and garbage-collectable                |

## Manifest shape direction

The manifest should remain a shared contract, not a runtime implementation. Additive metadata can describe extension surfaces without forcing every host to execute them:

```json
{
  "id": "@aretw0/theme-hub",
  "entry": "./dist/index.mjs",
  "extensions": {
    "surfaces": [
      {
        "layer": "homestead",
        "kind": "panel",
        "id": "theme-library",
        "slot": "settings"
      },
      { "layer": "asset", "kind": "theme-pack", "id": "default-themes" },
      { "layer": "automation", "kind": "workflow-step", "id": "rotate-theme" }
    ]
  }
}
```

Hosts that do not understand a surface must ignore it safely. Hosts that do understand it must still enforce capabilities, integrity, and trust policy before activation.

The shared manifest package exposes small host-neutral helpers for this contract:

- `getExtensionSurfaces(manifest, layer?)` for layer-scoped discovery;
- `extensionSurfaceKey(surface)` for stable `layer:id` keys;
- `isExtensionSurfaceLayer(value)` for host-side guards.

Homestead already consumes this contract for `homestead` surfaces: `StudioShell`
resolves legacy `ui.slots` plus manifest-declared `extensions.surfaces[]` entries
with `layer: "homestead"` and mounts them into the declared shell slot. Surface
slot resolution now gates declared surface capabilities against the Homestead
allow-list before mounting; deeper runtime activation remains trust-gated by the
plugin host.

Mounting preserves surface identity in the DOM and telemetry. Extension surface
wrappers receive `data-refarm-surface-layer`, `data-refarm-surface-kind`, and
`data-refarm-surface-id`; every mount emits `ui:surface_mounted` with slot,
source, and surface metadata. This gives future Studio tooling an auditable path
from manifest declaration to actual UI activation.
The Homestead SDK also exports `listMountedHomesteadSurfaces(...)` so `apps/dev`
and future inspectors can query the currently mounted surface graph from the DOM
without coupling to private shell internals.
Homestead also owns the semantic diagnostics helpers for this graph:
`mountedHomesteadSurfaceKey(...)` produces stable mount identity keys and
`observeMountedHomesteadSurfaceChanges(...)` centralizes which telemetry events
can change the mounted surface graph. Apps can render their own diagnostics, but
they should not duplicate Homestead's surface semantics.
Stream rendering now writes into its own `[data-refarm-stream-panel]` child
instead of replacing the entire `streams` slot, so plugin-provided panels mounted
into that slot survive live stream updates. Declared surface mounts also unhide
their target slot during activation.
The Studio app now consumes that helper through the
`@refarm.dev/homestead/sdk/surface-inspector` subpath and renders a small mounted
surface inspector that refreshes from Homestead surface telemetry. This closes the loop from manifest
declaration to visible Studio diagnostics while keeping private shell internals
encapsulated.

Short-term UI experiments should land in Homestead and the Studio app
(`apps/dev`), not the `me` or `social` surfaces. Those app surfaces can consume
stabilized primitives after the Studio shell proves the workflow.

Framework-agnostic visual primitives belong in `@refarm.dev/ds`. Homestead and
`apps/dev` should keep domain behavior local, but consume DS classes for shared
surfaces, panels, pills, badges, buttons, cards, code chips, and workbench
composition. This keeps stream-specific rendering out of the design system while
still preventing UI drift across hosts.

## Daily-driver order of attack

1. **UI stream renderer** — first `homestead`/UI consumer of generic `StreamSession` and `StreamChunk` views. Initial statusbar, richer stream panel, and slot-level capability gate landed; next step is a plugin-provided panel/editor surface with deeper runtime trust checks.
2. **Project memory surface** — durable `.project`/graph-backed work state usable across sessions.
3. **Automation surface** — reminders/scheduled checks with explicit ownership and retry rules.
4. **Plugin management surface** — install/list/remove plugins with SHA-256 validation and OPFS cache visibility.
5. **Multi-surface examples** — at least one plugin that combines UI + automation + assets without violating schema-neutral sync.

## Non-goals for now

- No version-number promise (`v0.2.0+`) just because a surface is documented.
- No implicit execution of unknown surfaces.
- No schema-specific logic in `BrowserSyncClient`.
- No public manifest freeze until the multi-surface model has survived daily use.
