# ADR-086: Plugin Vocabulary Convergence — One Verb, N Natures

**Status**: Proposed
**Date**: 2026-07-10
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-085 (Open Surface Projection Axis — unifies *surfaces*; this ADR
unifies the *command verb* at the CLI level, the sibling collision at a different
granularity), ADR-084 (Plugin Dispatch Model), ADR-083 (Canonical Plugin WIT
Contract), ADR-027 (Compositional Plugin Architecture),
`docs/EXTENSIBILITY_MODEL.md`, `packages/plugin-manifest`
(`PluginManifest.capabilities.provides` + `extensions.surfaces`),
`apps/refarm/src/commands/{extension,plugin}*.ts`

---

## Context

The CLI carries **two top-level commands for one concept**: `extension` and
`plugin`. This is a vocabulary fracture, not a model fracture — and the fracture
actively confuses.

The doctrine (Arthur): *"é tudo plugin mesmo que alguns sejam em níveis
diferentes, alguns vão ser WASM, outros só CSS, só JS, só HTML, só skills, ou tudo
junto."* One concept — **plugin** — with N natures. The nature (WASM component /
skill prose / CSS theme / mixed) is an **attribute** of the plugin, not a separate
kind of thing, and not something the *verb* should encode.

**The model already supports the vision.** A single `PluginManifest` declares, in
one document, `capabilities.provides` (WASM verbs, the sandboxed nature) **and**
`extensions.surfaces: ExtensionSurfaceDeclaration[]` (`{layer, kind, assets}` — the
skill/theme/asset natures). "A plugin is WASM + skills + a theme together" is
already expressible. The fracture is purely in the **command surface**.

**The fracture is also structural, not only lexical.** The two commands sit on
two *different* grouping mechanisms in the CLI projector:

- **`plugin`** is the canonical shape: a `CapabilityGroup`
  (`createPluginCapabilityGroup`) whose verbs are internal descriptors, projected
  to a top-level command by `capabilityCliCommands()` — the "declare once, light up
  on every surface" path that `model`/`skill`/`theme`/`health`/`vault` also use.
- **`extension`** is the legacy hybrid: a hand-written Commander command
  (`extensionCommand`, with raw `.command("new")`/`.command("list")`) that
  *self-populates* its `review`/`install` sub-verbs by calling
  `capabilityCliCommandsForGroup("extension")` over two standalone top-level
  descriptors tagged `transports.cli.group: "extension"`.

So a descriptor tagged `group: "plugin"` would NOT appear under the `plugin`
command — nobody calls `capabilityCliCommandsForGroup("plugin")`; the group's verbs
are internal to the `CapabilityGroup`. Convergence therefore also means **migrating
`extension` off the hybrid pattern onto the canonical `CapabilityGroup`** — moving
each verb's logic *into* the group as an internal descriptor, not flipping a
`group` string. This is the "não-lançado = canônico, não legado" doctrine applied:
the unreleased surface converges on the one right shape.

Today the two commands split by nature-as-verb:

- **`extension`** (authoring/composition of local, mostly-TS natures):
  `extension new <name>` (scaffold, the `--verb` path), `extension review <path>`
  (policy gate), `extension list` (local extensions under `.refarm/extensions/`),
  `extension install <path>` (install ONE reviewed unit from a path, with grants +
  re-review).
- **`plugin`** (lifecycle of the WASM nature): `plugin install` (sync ALL bundled
  plugins, `--force`), `plugin bundle <input>`, `plugin reload`, `plugin list`
  (installed plugins), `plugin revoke`, `plugin approve`.

**Two verbs collide with different semantics** — this is why convergence is not a
mechanical rename:

| verb | `extension` semantics | `plugin` semantics | collision |
| --- | --- | --- | --- |
| `install` | install ONE unit from a **path** (review + grants) | sync **ALL bundled** (no path, `--force`) | **yes** |
| `list` | list **local** authored units | list **installed** units | **yes** (local vs installed) |
| `review` | audit an authored unit | — | no |
| `new` | scaffold (the `--verb` path) | — | no |
| `bundle`/`reload`/`revoke`/`approve` | — | WASM lifecycle | no |

Naively moving `extension install`/`extension list` under the `plugin` group would
put two `install` verbs (and two `list` verbs) in the same command group — the
group projector would collide. Convergence therefore requires **deciding the
unified semantics** of `install` and `list` over the single concept, not just
retargeting a `group` string.

## Decision

**`plugin` is the single command for the single concept. The nature (WASM / skill
/ theme / mixed) is detected from what is operated on, never encoded in the verb.
`extension` becomes a deprecated alias that forwards to `plugin`.**

### 1. `plugin install` — one verb, both intents, nature-detected

`install` accepts an **optional target**; the presence/shape of the target selects
the intent, and the target's manifest selects the nature:

```
plugin install <path>        # install ONE unit from a path
                             #   (was `extension install <path>`; keeps --grant, --policy,
                             #    the re-review gate)
plugin install --bundled     # sync ALL bundled plugins
                             #   (was `plugin install`; keeps --force)
plugin install               # no target: same as --bundled (the mass-sync default,
                             #   preserving today's `plugin install` behavior)
```

- With a `<path>`, the nature is read from the unit's manifest
  (`capabilities.provides` ⇒ WASM; `extensions.surfaces` ⇒ skill/theme/asset;
  both ⇒ mixed). The installer routes on the manifest, not on which command the
  operator typed. "One verb, N natures" holds: the operator says *install this*;
  the manifest says *what it is*.
- `--bundled` is mutually exclusive with a positional `<path>` (installing a
  specific unit and syncing the fixed bundled set are distinct intents; asking for
  both is an error, not a merge).

### 2. `plugin list` — one verb, origin as a filter

```
plugin list                    # all known plugins (local + installed), origin-tagged
plugin list --origin local     # authored/local only   (was `extension list`)
plugin list --origin installed # installed only         (was `plugin list`)
```

Each row carries its `origin` (`local` | `installed`) and its detected nature, so
the two lists that diverged become one reader with a filter — the same collapse
ADR-085 does for surface readers, one granularity down.

### 3. `plugin new` / `plugin review` — authoring under the one verb

`extension new` → `plugin new` (unchanged scaffold, incl. `--verb`), `extension
review` → `plugin review` (unchanged policy gate). Authoring and lifecycle are
phases of the same concept, so they live under the same command.
`bundle`/`reload`/`revoke`/`approve` are unchanged.

### 4. `extension` is a deprecated alias, not a second surface

`extension <verb> …` forwards to `plugin <verb> …` (with `extension install`
mapping to `plugin install <path>` and `extension list` to `plugin list --origin
local`, preserving each old invocation's exact behavior), emitting a deprecation
notice to stderr (never into `--json` stdout — the JSON envelope stays clean). The
alias keeps existing handoffs, docs, and muscle memory working through the
transition; removal is a later, separate decision (a MAJOR, tracked below).

## Consequences

**Enables**
- One command, one mental model: *plugin*. Nature is an attribute, matching the
  manifest that already unifies WASM + surfaces.
- `install`/`list` stop meaning two different things depending on which command
  you reached for.
- The convergence the runtime-helper (`definePlugin` / `@refarm.dev/plugin-guest`)
  is being born into: the authoring path is named `plugin` from day one.

**Costs / risks**
- `plugin install` grows a mode split (path vs `--bundled`); the pure install
  report must branch cleanly and both branches stay byte-stable + tested, or the
  envelope contract drifts.
- Nature-detection-from-manifest is a new routing point; an ambiguous/empty
  manifest must fail loudly (loud > silent, per CLAUDE.md), not install nothing
  quietly.
- The `extension` alias is transitional debt; without a tracked removal it becomes
  permanent and the fracture half-persists.
- CLI contract change ⇒ handoffs lane (`refarm agent finish --lane handoffs`) and
  the `extension*.test.ts` suites migrate with the verbs.

## Alternatives considered

- **Only rename the non-colliding verbs (new/review), leave install/list under
  `extension`.** Rejected as the target (it was offered and declined): it leaves
  the actual confusion — the two `install`/`list` semantics — unresolved, and
  keeps `extension` alive as a real second command rather than a thin alias.
- **Fuse `install` into a single mass-or-single with heuristics on the argument
  only.** Kept in spirit, but the nature routing is anchored on the *manifest*, not
  argument-shape guessing, so a path always means "this unit, whatever nature it
  declares."
- **Rename `plugin` → `extension` instead.** Rejected: `plugin` is the
  installable-unit noun the manifest and ADR-027/083/084 already use;
  `extension.surfaces` is a *part* of a plugin, not the whole.

## Rollout (phased, not one commit)

1. `plugin new` + `plugin review` (move the non-colliding authoring verbs to the
   `plugin` group; `extension new/review` become alias forwards). Behavior
   identical, tested.
2. `plugin list --origin` (unify the two lists behind one origin-filtered reader;
   `extension list` → alias for `--origin local`). Behavior identical per origin,
   tested.
3. `plugin install <path> | --bundled` (unify the two installs with
   manifest-driven nature routing; `extension install <path>` → alias). Both
   branches byte-stable, tested — the highest-risk slice, last.
4. `extension` becomes a pure deprecated alias command (forward + stderr notice);
   handoffs regenerated. Removal tracked as a future MAJOR.
