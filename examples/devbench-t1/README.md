# devbench-t1 — the developer's extension bench (T1)

A per-work POC app: its own CLI (`dgk`). Presented in
**process mode** — the opposite of T2/T3. Instead of hiding the machine behind a
finished product, devbench **shows the machine being extended**: an extension declares
itself and its verbs surface by themselves. The angle is technical and general —
"declare once → it appears everywhere".

## What it demonstrates

Extending refarm the refarm way — not importing a package, but declaring an extension
that multi-surfaces:

```bash
dgk extension                # what the coding-agent extension declares, and how it surfaces
dgk actions --json           # selectable multi-surface action rows
dgk code prompt='...'        # a verb that came from the manifest, not from app code
dgk review                   # ditto — surfaced by the bridge, dispatched to the plugin
dgk serve                    # the surfaced verbs on a web surface too
```

`src/persona.ts` declares a **plugin manifest** for a coding-agent
(`provides: ["agent:code", "agent:review"]`). The bridge (`registerPluginCapabilities`)
synthesizes a first-class verb per declared entry, with a host-built dispatch `run()`
the developer never writes. `extension` makes the mechanism visible: declaration →
surfaced verbs. This is the extension effect — an installed extension appearing on every
surface by itself.

## Two layers

- **Generic (refarm, unchanged):** the neutral `source` / `records` / `vault` chain
  **plus** the extension path (manifest → bridge → multi-surface).
- **Specific (this app):** the coding-agent manifest + the inspector verb. In a real
  deployment the agent would be a WASM plugin the developer builds and installs; here
  the manifest is inline and the dispatch is captured, so the *process* is observable
  without a daemon.

## Run it

```bash
pnpm --filter devbench-t1 build
pnpm --filter devbench-t1 dgk extension
pnpm --filter devbench-t1 dgk actions --json
pnpm --filter devbench-t1 dgk --help    # code / review surfaced alongside the neutral verbs
```

## Focus — what T1 makes shine (survives our design conversation)

**Persona & mode.** The developer; **process mode** — show the MACHINE being extended,
not a finished product. T1 is technical and general: "declare once → it appears
everywhere."

**The scenario to record.** Show the developer:
1. **Installing the coding-agent locally** — the coding-agent is a plugin that already
   exists (`packages/agent`); T1 demonstrates installing it, not building it.
2. **Developing a NEW extension** live — declaring it, watching it surface across CLI /
   TUI / web from one declaration (the extension effect, `dgk extension` makes it visible).
   The verb comes in via a plugin manifest, dispatched over the WASM boundary — no
   hand-written run().

**The easter egg (hidden continuity T1 → T3).** The extension developed here is —
without saying so — the one **T3 uses**. Pick something T3 consumes (e.g. a requirements
renderer / an enrichment provider). Copy/paste between examples is fine. Nobody states
the link; someone viewing all three side by side notices T1 created what T3 consumes. T3
uses it as if it already existed.

**What to build for a rich demo.**
- The coding-agent installed + driven (a real dev task, even scoped).
- The new extension built via the refarm extension path (manifest → multi-surface),
  ideally the very source/enrichment/renderer WASM provider T3 then loads.
- The surfaces (CLI + TUI + web) showing the same verb, proving "declare once".

**What stays generic (refarm) vs specific (here).** refarm ships the neutral chain +
the extension path + the CLI/TUI/web surfaces. This app supplies the dev scenario and
the easter-egg extension. Swap the scenario, keep the machine.
