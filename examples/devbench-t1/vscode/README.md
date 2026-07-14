# Extension Bench — VS Code extension

The editor face of the bench. Its command set + tree view are **not hand-written**: they are
generated from the bench's capability registry, the same declaration that drives the CLI, the TUI,
and the web. Declare a verb once; it lights up in the editor too.

## How it works

1. `dgk vscode-manifest --apply` generates `package.json` (this folder) — the `contributes` block
   (commands, an activity-bar tree view, palette entries, activation events) from the bench's
   `IdeModel` (`@refarm.dev/capabilities` `buildVscodeManifest`). It is a DERIVED file (gitignored).
2. `src/extension.ts` is the thin shell: `activate()` registers each contributed command to run
   `dgk <verb>` in a terminal, and paints the command tree in the bench's view. It is typed against
   a minimal local `vscode` interface (the real module is injected by the editor at runtime), so it
   pulls no heavy `@types/vscode`.

So the surface is the same declare-once projection — CLI + TUI + IDE — with no bespoke editor code
beyond the shell.

## Build (outside this repo's default flow)

The extension is a separate build target (it isn't part of the example's `tsc`):

```sh
dgk vscode-manifest --apply     # (re)generate package.json from the current registry
# then, with the extension toolchain installed:
#   npm install && npm run compile && vsce package
```

This example ships the source + the generator; packaging a `.vsix` needs the VS Code extension
toolchain (`@vscode/vsce`), which the repo does not vendor.
