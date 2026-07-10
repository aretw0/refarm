# ADR-086: Plugin Vocabulary Convergence — One Verb, N Natures

**Status**: Accepted (CLI convergence phases 1-5 done; phase 6 retired; phase 7 resolver being chewed origin-by-origin — 7a `url` DONE, `npm`/`git`/p2p remain)
**Date**: 2026-07-10
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-085 (Open Surface Projection Axis — unifies *surfaces*; this ADR
unifies the *command verb* at the CLI level, the sibling collision at a different
granularity), ADR-084 (Plugin Dispatch Model), ADR-083 (Canonical Plugin WIT
Contract), ADR-027 (Compositional Plugin Architecture),
`docs/EXTENSIBILITY_MODEL.md`, `packages/plugin-manifest`
(`PluginManifest.capabilities.provides` + `extensions.surfaces`),
`apps/refarm/src/commands/{plugin,extension}*.ts` (`extension*` renamed to
`plugin*` in phase 5), `@refarm.dev/barn` (`PluginPackageSource`) and
`@refarm.dev/tractor-ts` (`install-plugin` provenance) — distinct axes that
COEXIST with `PluginOrigin`, not merged (see §0)

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
/ theme / mixed) is detected from what is operated on, and the ORIGIN (local /
npm / git / …) is detected from the shape of the reference — never encoded in the
verb. `extension` becomes a deprecated alias that forwards to `plugin`.**

### 0. Two orthogonal attributes, both detected — never verbs

A plugin has two attributes the verb must NOT encode; both are inferred, so one
`install`/`list` pair serves all combinations:

- **Nature** — WHAT it is: WASM (`capabilities.provides`) / skill·theme·asset
  (`extensions.surfaces`) / mixed. Read from the **manifest**.
- **Origin** — WHERE it comes from: `local` (authored in `.refarm/`) / `installed`
  (already materialized) / `npm` (a published package) / `git` (a repo) / `url`
  (a direct descriptor URL) / `bundled` (shipped with refarm). Detected from the
  **shape of the reference** (`./path` ⇒ local, `@scope/pkg` ⇒ npm, a git URL ⇒
  git, `https://…/x.wasm` ⇒ url), or carried as provenance on an installed unit.

**`PluginOrigin` is a NEW app-owned field, not a merge of existing ones.** An
earlier draft claimed three "origin notions" the code had fractured and should
converge into one `PluginOrigin`. Verifying at the source (the discipline this
repo demands) corrected that: they are THREE DIFFERENT axes that only share the
word "source", and they legitimately coexist —
- `PluginOrigin` (this ADR, `apps/refarm/.../plugin-shared.ts`) — WHERE a plugin
  comes from: local / npm / git / url / bundled. Distribution provenance.
- `PluginPackageSource: "node_modules" | "workspace" | "unresolved"`
  (`@refarm.dev/barn`) — where an npm package RESOLVED ON DISK. A sub-detail of an
  npm/bundled origin, complementary; `PluginListEntry` already carries BOTH
  (`source: PluginOrigin` + `packageSource: PluginPackageSource`), correctly.
- `install-plugin.ts`'s `source: "descriptor" | "direct"` + build metadata
  (`@refarm.dev/tractor-ts`, browser/OPFS) — HOW a remote descriptor was fetched.
  Build provenance (commitSha/buildId), a different concept again.

So there is NO §8 field to widen and nothing to converge across barn/tractor-ts:
`PluginOrigin` is added where it belongs (the app inventory) and the two runtime
notions stay as the distinct axes they are. (This retires what the rollout below
had queued as phase 6.)

### 1. `plugin install` — one verb, all origins + all natures

`install` accepts an **optional reference**; its shape selects the origin, its
manifest selects the nature:

```
plugin install <path>        # a local prepared unit      (origin: local)
                             #   (was `extension install <path>`; keeps --grant, --policy,
                             #    the re-review gate)
plugin install <@scope/pkg>  # a published npm package     (origin: npm)
plugin install <git-url>     # a git repo                  (origin: git)
plugin install <https-url>   # a direct descriptor/wasm URL (origin: url)
plugin install --bundled     # sync ALL bundled plugins    (origin: bundled)
                             #   (was `plugin install`; keeps --force)
plugin install               # no reference: same as --bundled (preserves today's
                             #   `plugin install` mass-sync behavior)
```

- The origin is inferred from the reference shape; the nature is read from the
  resolved unit's manifest (`capabilities.provides` ⇒ WASM; `extensions.surfaces`
  ⇒ skill/theme/asset; both ⇒ mixed). The installer routes on reference + manifest,
  not on which command the operator typed. "One verb, N natures × N origins" holds:
  the operator says *install this*; the reference says *from where*; the manifest
  says *what it is*.
- `--bundled` is mutually exclusive with a positional reference (syncing the fixed
  bundled set and installing a specific unit are distinct intents; asking for both
  is an error, not a merge).
- **Scope of THIS ADR's rollout**: the `local` and `bundled` origins are unified
  first (they exist today as `extension install <path>` and `plugin install`). The
  `npm`/`git`/`url` origins are the resolver seam — they compose onto the same
  verb but land as follow-on slices behind the resolver work
  (content-addressed / p2p / registry), NOT silently in the CLI slice. The verb is
  designed to admit them; the resolvers arrive separately and are logged as
  not-yet-wired rather than pretended-complete.

### 2. `plugin list` — one verb, origin as a filter

```
plugin list                    # all known plugins, origin-tagged
plugin list --origin local     # authored/local only    (was `extension list`)
plugin list --origin installed # installed only         (was `plugin list`)
plugin list --origin bundled   # shipped-with-refarm only
plugin list --origin npm|git   # by published provenance (as the resolver lands them)
```

Each row carries its `origin` (the `PluginOrigin` vocabulary above) and its
detected nature, so the two lists that diverged become one reader with a filter —
the same collapse ADR-085 does for surface readers, one granularity down. Origins
not yet resolvable (`npm`/`git`/`url`) are valid filter values that simply match
nothing until the resolver wires them — the list never lies about coverage.

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

1a. ✅ **DONE** (3cd6379a). `plugin review` moves onto the canonical `plugin`
    CapabilityGroup (the non-colliding gate). Builder neutralized with
    `commandName`; `extension review` stays byte-identical; proven by pins + e2e.
1b. ✅ **DONE** (c23bd72e). `plugin new` — extracted a pure report builder from
    `newExtension` into the leaf `extension-scaffold.ts` (which also broke the
    registry import cycle); mounted as a `plugin` verb; `extension new` unchanged.
2.  ✅ **DONE** (1344060d). `plugin list --origin` unifies the two lists behind one
    origin-filtered reader over the `PluginOrigin` vocab. bundled + local resolve;
    npm/git/url are valid-but-empty; unknown origin fails loud.
3.  ✅ **DONE** (fbbab3e2). `plugin install <ref> | --bundled` unifies the two
    installs with origin-from-reference (`detectPluginOrigin`) + the same
    review-first gate. local + bundled wired; npm/git/url fail loud (not-wired).
4.  ✅ **DONE** (ca66e55c). `extension` becomes a deprecated alias: a preAction hook
    emits a stderr notice pointing at the `plugin` equivalent (suppressed on
    `--json`); help documents the mapping. Removal is a future MAJOR.
5.  ✅ **DONE** (414e8656). Renamed `extension*.ts` → `plugin*.ts` (git mv +
    repoint) so the SOURCE vocabulary matches the command vocabulary (Arthur:
    "iremos mudar os arquivos de extension para plugin também"). Behavior-neutral,
    1396 tests unchanged. Deferred until the CLI convergence settled so each rename
    diff stayed a pure move.
6.  ~~**(§8)** Converge the three "source" notions.~~ **RETIRED** — verifying at
    the source showed they are DISTINCT axes that coexist, not one to merge (see
    §0). `PluginOrigin` is a new app-owned field; barn's `PluginPackageSource` and
    tractor-ts's fetch-provenance stay as-is. No §8 change needed.
7.  **(resolver seam, chewed origin by origin)** Wire the `npm`/`git`/`url`/p2p
    resolvers behind `plugin install <ref>` (content-addressed identity, per the
    plugin-resolver work). Origins land one at a time; an unwired one still fails
    loudly with a "resolver not wired" envelope, never a silent no-op.
    7a. ✅ **DONE** (`url`). `plugin install <https-url>` fetches a plugin
        DESCRIPTOR (a `plugin.json`-shaped JSON with `id`/`entry`/`integrity`),
        fetches the wasm, and VERIFIES it against the declared integrity via
        `verifyContentHash` (the same content-addressed hash gate the p2p
        `AssetResolver` enforces) BEFORE storing or trusting it — tampered bytes
        are rejected, never installed. Then content-stores the bytes + writes a
        self-contained local manifest (`file://` entry), the SAME on-disk shape a
        bundled/local install produces. `buildUrlInstallReport` is the remote
        sibling of `buildExtensionInstallReport`; `fetch` is injected for tests
        (6 tests: verify-pass, integrity-mismatch reject, descriptor/wasm fetch
        failure, invalid descriptor, malformed integrity). No execution at
        install — only fetch + verify + store.
    7b. **(still loud not-wired)** `npm` (package resolution + build) and `git`
        (clone + build) remain follow-ons; the p2p transport behind
        `createPeerAssetResolver` is dormant (the verify gate is wired, the
        transport is not).

## White-label seam: injectable bundled set (done, alongside the rollout)

`plugin list --origin bundled` and `plugin install --bundled` iterate a bundled
plugin set that was hardcoded to refarm's own (`BUNDLED_PLUGINS` =
`REFARM_BUNDLED_PLUGIN_DESCRIPTORS`). That made the converged `plugin` command
NOT white-label: any app composing refarm's blocks would sync refarm's plugins,
not its own. Closed by threading the set through as injected data (the
per-descriptor install was already origin-neutral — only the LIST was fixed):

- `buildInstallReport` / `buildPluginListReport` take an optional
  `bundled` list, defaulting to `BUNDLED_PLUGINS` (refarm unchanged).
- `PluginCommandDeps.bundledPlugins` flows the app's set into both builders.
- `refarmBuiltinCapabilities({ bundledPlugins })` — the two-layer seam — lets a
  white-label app inject its set when composing the built-ins; no options = refarm
  defaults. Proven: with an injected set, `install --bundled` targets the app's id,
  never `@refarm/agent`.

This is the "refarm = neutral substrate, the app supplies the specific" doctrine
applied to the bundled set. Sibling white-label debts remain (hardcoded `refarm
<verb>` handoffs; the two-layer seam not yet exercised by a real second app — the
T1 example is the intended forcing function).
