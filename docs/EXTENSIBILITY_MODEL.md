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
| `homestead`  | browser shell / `apps/me`       | panels, widgets, editors, stream renderers                      | mounts in real DOM slots and reconnects after reload     |
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

## Daily-driver order of attack

1. **UI stream renderer** — first `homestead`/UI consumer of generic `StreamSession` and `StreamChunk` views.
2. **Project memory surface** — durable `.project`/graph-backed work state usable across sessions.
3. **Automation surface** — reminders/scheduled checks with explicit ownership and retry rules.
4. **Plugin management surface** — install/list/remove plugins with SHA-256 validation and OPFS cache visibility.
5. **Multi-surface examples** — at least one plugin that combines UI + automation + assets without violating schema-neutral sync.

## Non-goals for now

- No version-number promise (`v0.2.0+`) just because a surface is documented.
- No implicit execution of unknown surfaces.
- No schema-specific logic in `BrowserSyncClient`.
- No public manifest freeze until the multi-surface model has survived daily use.
