# devbench-t1 — the developer's extension bench (T1)

A per-work POC app: its own CLI (`devbench`), refarm underneath. Presented in
**process mode** — the opposite of T2/T3. Instead of hiding the machine behind a
finished product, devbench **shows the machine being extended**: an extension declares
itself and its verbs surface by themselves. The angle is technical and general —
"declare once → it appears everywhere".

## What it demonstrates

Extending refarm the refarm way — not importing a package, but declaring an extension
that multi-surfaces:

```bash
devbench ext-inspect         # what the coding-agent extension declares, and how it surfaces
devbench code prompt='...'   # a verb that came from the manifest, not from app code
devbench review              # ditto — surfaced by the bridge, dispatched to the plugin
devbench serve               # the surfaced verbs on a web surface too
```

`src/persona.ts` declares a **plugin manifest** for a coding-agent
(`provides: ["agent:code", "agent:review"]`). The bridge (`registerPluginCapabilities`)
synthesizes a first-class verb per declared entry, with a host-built dispatch `run()`
the developer never writes. `ext-inspect` makes the mechanism visible: declaration →
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
pnpm --filter devbench-t1 devbench ext-inspect
pnpm --filter devbench-t1 devbench --help    # code / review surfaced alongside the neutral verbs
```
