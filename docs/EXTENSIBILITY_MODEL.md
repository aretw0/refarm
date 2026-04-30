# Refarm Extensibility Model

Refarm should unlock extension without locking the ecosystem into one runtime. The long-term model is **multi-surface, capability-scoped, and promotion-gated**: start with the least-friction plugin shape that solves a real daily-driver need, then harden only the surfaces that earn production use.

## Principles

1. **One manifest, many surfaces** — a plugin may expose headless runtime behavior, UI slots, automations, local scripts, assets, or desktop integrations under one identity.
2. **Schema-neutral transport** — sync layers move graph updates; they do not special-case plugin kinds, stream nodes, or UI widgets.
3. **Capability-first security** — hosts authorize declared capabilities per surface; entry format alone is not a trust model.
4. **Progressive hardening** — JS is acceptable for L0/L1 onboarding; WASM and stronger provenance become the L2/L3 path for sensitive or shared plugins.
5. **Daily-driver proof before ecosystem promise** — an extension surface is promoted only after it survives the creator's real workflow.

## Canonical surfaces

| Surface      | Host                              | Typical use                                                     | Promotion signal                                         |
| ------------ | --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `tractor`    | native/headless daemon            | storage adapters, indexers, agent/tool bridges, background work | passes scoped runtime tests and survives daemon restart  |
| `homestead`  | browser shell / `apps/dev` Studio | panels, widgets, editors, stream renderers                      | mounts in real DOM slots and reconnects after reload     |
| `pi`         | local automaton / agent harness   | filesystem tools, local scripts, reminders, hardware hooks      | host-authorized, auditable, and recoverable from handoff |
| `automation` | Windmill/workflow layer           | scheduled tasks, macros, recurring operations                   | ownership and retry semantics are explicit               |
| `desktop`    | native/OS integration             | file watchers, tray/menu actions, platform affordances          | isolated permissions and rollback path exist             |
| `asset`      | cache/CDN/OPFS                    | themes, templates, dictionaries, model files                    | integrity checked and garbage-collectable                |

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
Homestead resolves this as an explicit activation plan: accepted mounts plus
rejections for missing slots, missing required capabilities, unsupported
capabilities, or duplicate surface IDs. The shell emits `ui:surface_rejected`
telemetry for rejected declarations, so capability filtering is visible to
Studio diagnostics instead of failing silently.
The shell also passes its discovered DOM slot allow-list into activation
planning, so manifest surfaces targeting unknown Homestead slots are rejected as
`unknown-slot` before any wrapper is created. Legacy `ui.slots` entries outside
the current shell are ignored for compatibility, while the multi-surface path is
audited explicitly.
Homestead extension surfaces must explicitly declare `ui:panel:render` before
activation. This keeps render authority opt-in at the surface declaration level:
omitted capabilities are not treated as implicit permission to render UI.
Homestead also allow-lists surface `kind` values before activation (`panel`,
`widget`, `statusbar`, and `editor` by default). Unsupported kinds are rejected
as `unsupported-kind` until the host intentionally exposes the behavior and trust
model for that kind.
Finally, the shell checks plugin trust before mounting otherwise valid extension
surfaces. Internal Studio plugins (`internal:*`) are allowed explicitly; external
plugin surfaces must come from a registry entry in `validated` or `active` state,
otherwise they are rejected as `untrusted-plugin` with registry status in
telemetry.

Mounting preserves surface identity in the DOM and telemetry. Extension surface
wrappers receive `data-refarm-surface-layer`, `data-refarm-surface-kind`,
`data-refarm-surface-id`, and `data-refarm-surface-render-mode`; every mount
emits `ui:surface_mounted` with slot, source, and surface metadata. If a trusted
plugin implements `renderHomesteadSurface`, Homestead calls it with the plugin
id, slot id, mount source, surface declaration, and locale. Hosts can also
configure a surface context provider that adds optional host-owned context and
action descriptors under `host`, without hiding host-specific plugin
registration or adding app behavior to Homestead. The SDK owns the reusable
matching helper (`createScopedHomesteadSurfaceContextProvider(...)`); hosts own
the concrete data and actions they expose. Plain string and
`{ "text": "..." }` results write text; `{ "html": "..." }` is explicit
trusted HTML. Rendered surfaces then emit `ui:surface_rendered`, while thrown
hook failures mark the wrapper as `failed` and emit `ui:surface_render_failed`.
Studio can therefore distinguish wrapper-only mounts, context-aware executable
plugin-provided UI, and failed executable surfaces.
The Homestead SDK also exports `listMountedHomesteadSurfaces(...)` so `apps/dev`
and future inspectors can query the currently mounted surface graph from the DOM
without coupling to private shell internals.
Homestead also owns the semantic diagnostics helpers for this graph:
`mountedHomesteadSurfaceKey(...)` produces stable mount identity keys and
`observeMountedHomesteadSurfaceChanges(...)` centralizes which telemetry events
can change the mounted surface graph. Apps can render their own diagnostics, but
they should not duplicate Homestead's surface semantics.
Rejected activation telemetry is also normalized by Homestead helpers, while the
Studio inspector displays recent `ui:surface_rejected` events from Tractor's
telemetry buffer and refreshes when new rejection events arrive.
Studio also exposes `/surfaces` as a dedicated activation ledger. That page
boots a tiny diagnostics runtime to prove the policy path: an explicit internal
surface mounts, a registry-validated external surface renders, and an external
unregistered surface is rejected as `untrusted-plugin` with registry status
visible in a structured ledger presenter.
The Homestead `surface-inspector` remains intentionally semantic/read-only;
Studio-owned presenters decide whether those diagnostics appear as tables,
graphs, filters, or compact statusbar summaries.
Stream rendering now writes into its own `[data-refarm-stream-panel]` child
instead of replacing the entire `streams` slot, so plugin-provided panels mounted
into that slot survive live stream updates. Declared surface mounts also unhide
their target slot during activation.
The opt-in Studio stream demo registers an internal manifest-declared
`homestead` panel in that same `streams` slot, giving the daily-driver path a
real surface mount to inspect without promoting the experiment into `me` or
`social` prematurely. Homestead owns the reusable action contract for those
surfaces: rendered controls identify host actions with
`data-refarm-surface-action-id`, `StudioShell` resolves them against the
host-provided context, emits action telemetry, and delegates the concrete effect
to the host-provided `surfaceAction` handler.
The Studio app now consumes that helper through the
`@refarm.dev/homestead/sdk/surface-inspector` subpath and renders both a compact
statusbar inspector and a structured `/surfaces` ledger that refresh from
Homestead surface telemetry. This closes the loop from manifest declaration to
visible Studio diagnostics while keeping private shell internals encapsulated.

Short-term UI experiments should land in Homestead and the Studio app
(`apps/dev`), not the `me` or `social` surfaces. Those app surfaces can consume
stabilized primitives after the Studio shell proves the workflow.

Framework-agnostic visual primitives belong in `@refarm.dev/ds`. Homestead and
`apps/dev` should keep domain behavior local, but consume DS classes for shared
surfaces, panels, pills, badges, buttons, cards, code chips, and workbench
composition. This keeps stream-specific rendering out of the design system while
still preventing UI drift across hosts.

## Daily-driver order of attack

1. **UI stream renderer** — first `homestead`/UI consumer of generic `StreamSession` and `StreamChunk` views. Initial statusbar, richer stream panel, slot-level capability gate, plugin-provided render hook, render-mode diagnostics, and a host-owned surface context/actions contract landed; next step is deeper runtime trust checks and real registered plugin flow.
2. **Project memory surface** — durable `.project`/graph-backed work state usable across sessions.
3. **Automation surface** — reminders/scheduled checks with explicit ownership and retry rules.
4. **Plugin management surface** — install/list/remove plugins with SHA-256 validation and OPFS cache visibility.
5. **Multi-surface examples** — at least one plugin that combines UI + automation + assets without violating schema-neutral sync.

## Non-goals for now

- No version-number promise (`v0.2.0+`) just because a surface is documented.
- No implicit execution of unknown surfaces.
- No schema-specific logic in `BrowserSyncClient`.
- No public manifest freeze until the multi-surface model has survived daily use.
