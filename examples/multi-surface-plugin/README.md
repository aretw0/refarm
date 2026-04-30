# Multi-surface plugin example

This example demonstrates the long-term Refarm extensibility contract: one plugin identity can declare multiple host surfaces without forcing every host to execute them.

## Surfaces

The manifest declares:

- `homestead` panel `stream-panel` mounted in the `main` shell slot;
- `asset` theme pack `stream-theme-assets` for cacheable theme resources;
- `automation` workflow step `summarize-terminal-stream` for future scheduled/workflow hosts;
- legacy `ui.slots` fallback for current shell compatibility.

Hosts that do not understand a surface should ignore it. Hosts that understand a surface should still enforce capability, integrity, and trust policy before activation.

## Validate

From the repository root:

```bash
node --input-type=module -e 'import fs from "node:fs"; import { validatePluginManifest, getExtensionSurfaces } from "./packages/plugin-manifest/src/index.js"; const manifest = JSON.parse(fs.readFileSync("examples/multi-surface-plugin/plugin-manifest.json", "utf8")); const result = validatePluginManifest(manifest); if (!result.valid) { console.error(result.errors); process.exit(1); } console.log(getExtensionSurfaces(manifest).map((surface) => `${surface.layer}:${surface.id}`).join("\n"));'
```

Expected surface keys:

```text
homestead:stream-panel
asset:stream-theme-assets
automation:summarize-terminal-stream
```
