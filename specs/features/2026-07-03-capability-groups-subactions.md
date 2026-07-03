# Capability Groups & Sub-actions (multi-surface)

**Status:** Design (not yet implemented)
**Date:** 2026-07-03
**Related:** commit 344c3970 (two-axis CapabilityDescriptor), ADR on DsTheme
multi-surface projection, `packages/cli/src/capabilities/`,
`apps/refarm/src/commands/{model,task,plugin,workspace,project}.ts`

---

## Problem

The `CapabilityDescriptor` (commit 344c3970) models a **flat verb** — `review`,
one `run()`. But migrating the `model` command revealed that **sub-commands are
the rule, not the exception**: 8 of the app's commands are verb-groups with
4–8 sub-commands each:

| Command | Sub-commands |
|---|---|
| model | current, doctor, providers, env, fallback, reset, base-url, set |
| workspace | execution, status, mounts, sources, declarations, materialize, refresh, list |
| task | resume, list |
| project | (7) |
| plugin | install, update, list, status |
| release, extension, task-support | (4 each) |

Each sub-command is already a **mini-verb**: its own `description`, `argument`,
`option`, `action`. So a rich command is structurally *a group of mini-verbs*.
The flat descriptor cannot represent this, which blocks every rich command from
becoming multi-surface. The fix must come **before** the model migration, so the
model becomes the first client of the *complete* pattern (the one that also
unblocks workspace/task/project/plugin).

## Constraint: keep the existing UX per surface

- **CLI:** `refarm model current`, `refarm model doctor --json`, and the
  group-default `refarm model <ref>` (bare group invokes a default action).
- **REPL:** `/model current`, `/model` (no arg → default `current`,
  chat-repl.ts:175), `/model providers`.
- **API (future):** `POST /model/current`, `POST /model/doctor`.
- **Web/TUI/VR (future):** the group is a section; each sub-action a route/entry.

## Design: a group is a neutral contract of child descriptors

Mirror the DsTheme precedent (neutral contract + per-surface projectors) one
level up. A sub-action **is** a `CapabilityDescriptor` (it already has
name/args/options/run + transports/renderers). A group only adds the parent
identity, the child map, and an optional default.

```ts
// packages/cli/src/capabilities/types.ts (additive — flat descriptors unchanged)

export interface CapabilityGroup {
  /** Group verb, lowercase. e.g. "model". */
  name: string;
  /** One line for `--help` / `/help` and the group landing. */
  summary: string;
  /**
   * The sub-actions, keyed by their sub-verb. Each value is a full
   * CapabilityDescriptor whose `name` is the sub-verb ("current", "doctor").
   * A child MAY declare its own transports/renderers (e.g. a web route per
   * sub-action); unset falls back to the group's projection.
   */
  actions: Record<string, CapabilityDescriptor>;
  /**
   * Sub-action run when the group is invoked with no sub-verb
   * (`refarm model`, `/model`). Must be a key of `actions`. Read-only by
   * convention (a bare group should never mutate). e.g. "current".
   */
  defaultAction?: string;
  /** Group-level surface hints; children inherit unless they override. */
  transports?: CapabilityTransports;
  renderers?: CapabilityRenderers;
}
```

**Why a group type and not `actions` on the flat descriptor:** a flat verb and a
verb-group are different shapes (a group has no `run()` of its own — it dispatches
to a child). Keeping them separate types means `extension-review` (flat) stays
untouched, and the registry can hold both `CapabilityDescriptor | CapabilityGroup`
without a flat verb accidentally growing children.

## Projectors (each reads the group + a child; run() stays the source of truth)

- **CLI (commander):** the group projector builds `new Command(group.name)`, then
  for each `[key, child]` adds `toCommanderCommand(child)` under it, and wires the
  group-default (bare invocation → run `actions[defaultAction]`). This replaces
  the hand-rolled `createModelCommand` tree.
- **REPL (/slash):** `/model <sub> …args` → look up `group.actions[sub]` (or
  `defaultAction` when `<sub>` is absent), then the SAME `parseCapabilityArgv`
  on the child + `child.run(input)`. This deletes the hardcoded
  `{kind:"model",action:…}` union in chat-repl.ts (lines 18–35) and its
  per-action `if` ladder — the divergence source.
- **API (http, future):** `POST /model/<sub>` → `actions[sub].run(input)` → the
  JSON envelope IS the response. Nearly free, because run() already returns JSON.
- **Web/TUI/VR (future):** the group is a menu section; each child a
  route/entry via its `renderers.web.route` etc.

The invariant holds: a projector only decides *where/how* the sub-verb appears;
`child.run()` decides *what it does*, identically on every surface.

## Interactive projection: menus, selection, keybindings (TUI/REPL)

A read-only sub-action like `current` prints on the CLI, but in a REPL/TUI
`/model` can open an **interactive multiple-choice menu** (pick a provider/model),
and model / thinking-level switches usually get **keybindings** — the way Claude
Code, Codex, and pi do. Crucially this must not disturb an agent effort running
at the same time.

The repo **already has the contracts** for this; the design reuses them rather
than inventing a second interaction model:

- **Affordances = the menu rows.** `SurfaceActionAffordanceRow`
  `{ index, id, label, intent?, display }` (`packages/cli/src/action-affordances.ts`)
  is a selectable option; `resolveSurfaceActionAffordanceSelection` resolves a
  pick by `id` or `index`. A sub-action's `run()` stays PURE and returns an
  envelope that *carries* affordance rows (e.g. the provider list) — it does not
  prompt. The **projector** decides the surface's interaction level:
  - **CLI / API (http):** render the affordances as a list / JSON array. No
    prompt; a caller re-invokes with the chosen id (`refarm model set <ref>`,
    `POST /model/set`). Non-interactive by nature.
  - **REPL / TUI:** render the affordances as an interactive select; the user
    picks a row; the projector then runs the corresponding sub-action (e.g. the
    picked provider → `set`). Selection is the projector's job; `run()` never
    blocks on input.
- **Keybindings.** A sub-action may carry a `shortcut` (the field already exists
  on `command-host.ts`'s command descriptor). The TUI projector binds it; CLI/API
  ignore it. So "switch model / thinking level" gets an accelerator on the TUI
  surface without the neutral core knowing about keys.
- **Not disturbing a running agent.** `InteractionDriverMode`
  (`"local-loop" | "gateway-rpc"`) + readiness (`ready | blocked` with
  requirements `lifecycle/steering/gateway/budget`,
  `packages/cli/src/interaction-driver.ts`) already models this. An interactive
  menu opens only when the driver is `ready`; while an effort/agent holds the
  loop the readiness is `blocked` and the menu defers — the REPL stays
  composable, a menu never steals the turn from a running agent.

**Where this lands in the shape:** it does NOT change `run()` (still pure,
returns an envelope) and does NOT change the group/child structure. It is a
**projector capability**: interactive projectors (TUI/REPL) read the envelope's
affordance rows + a child's optional `shortcut` and drive selection; non-
interactive projectors (CLI/API) render the same rows flat.

**Reuse the ONE menu mechanism the repo already has — do not build a second.**
`refarm` already runs "declare once, project N surfaces" for menus, just scoped
to host/status actions today: `createSurfaceActionAffordanceRows` +
`SurfaceActionReadinessDryRunEnvelope` (which carries `actionRows` + `selection`
+ `renderer`) are projected by three live surface adapters —
`apps/refarm/src/commands/{tui-actions,web-actions,headless-action}.ts`. A
selectable sub-action returns an envelope carrying `actionRows:
SurfaceActionAffordanceRow[]` (that same type, from `@refarm.dev/cli/action-
affordances` — same package, no new dep), and the SAME projectors/selection
resolver (`resolveSurfaceActionAffordanceSelection`, pick by id or index) render
it: TUI = interactive select, CLI/API = flat list/JSON. One menu contract in
refarm, not two. So a `/model` that offers a provider choice returns provider
affordance rows; the TUI projector turns them into a keybound quick-switcher, the
CLI prints them and the caller re-invokes `set <id>`. A future
`thinking`/`effort-level` group is the identical pattern.

## Registry

`CapabilityRegistry` holds groups too. Collision gate extends to group names +
each child's slash names (a group `model` reserves `model`; `/model current`
resolves group→child, never colliding with a top-level `current` verb unless one
exists). Reserved-name check unchanged in spirit.

## White-label

Unchanged from 344c3970: no hint bakes a bin/product name; group/sub names are
neutral tokens; `directAlias` stays a boolean the projector resolves at mount;
routes are host-relative. A downstream rebrands the bin without touching any
group or sub-action declaration.

## Migration order (after this contract lands)

1. Add `CapabilityGroup` + its two live projectors (CLI group mount, REPL group
   dispatch). Prove with a tiny 2-action fixture group in the capability tests.
2. Migrate `model` as the first real client:
   - **read-only first** (`current`/`providers`/`doctor`) — child `run()`s
     delegate to the existing pure `buildCurrentModelStatus` /
     `buildKnownModelProviders` / `buildModelDoctorStatus` (deps injected:
     `fetch` for doctor; tokens loaded via an injected port, not `process.env`).
     This alone gives the REPL `doctor` and `--json` it lacks today.
   - **mutators next** (`set`/`reset`/`fallback`/`base-url`/`env`) — child
     `run()`s delegate to the existing `setModelRoute` etc. with an injected
     `saveTokens` port; `process.exitCode` moves to surface hooks (as
     extension-review does). Config writes could later become nodes via the
     ledger (storage-node-view), unifying "config override is a node".
3. Then the other groups (workspace/task/project/plugin) follow the same molde.

## Risk

The single riskiest part is the **group-default + mutation** on `model`: a bare
`refarm model <ref>` mutates (sets the route) while a bare `/model` reads
(`current`). The design keeps `defaultAction` read-only and treats
`refarm model <ref>` as sugar for the `set` child with `scope=default` — making
the two surfaces' bare forms explicit and testable, instead of two divergent
implicit behaviours. Nothing here changes model behaviour; it re-expresses the
existing grammar as one declaration.
