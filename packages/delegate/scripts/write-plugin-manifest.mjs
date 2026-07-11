// Emit dist/plugin.json — the runtime PluginManifest that ships ALONGSIDE the built
// plugin.wasm, so the tractor host's read_runtime_plugin_manifest (which looks for a
// plugin.json next to the .wasm) knows the plugin's ENTRY and advertised capabilities.
//
// The delegate authors its manifest by hand in ./plugin.json (like lsp-code-ops). This
// script takes that authored manifest, strips the `_note` authoring comment, and stamps
// the two fields that only exist once the .wasm is built:
//   - entry:     "./plugin.wasm" (sits beside plugin.json in dist/)
//   - integrity: sha256 of the REAL built bytes, so validatePluginManifest accepts it.
//
// farmhand's bundleInstallPlugin RE-stamps entry+integrity at install time; this dist
// manifest is what makes the component self-sufficient for DIRECT loading (dev, harness).
//
// Run as the last step of `build:wasm`, after the .wasm exists.

import { computeSha256Digest, validatePluginManifest } from "@refarm.dev/plugin-manifest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const distDir = join(pkgDir, "dist");
const wasmPath = join(distDir, "plugin.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const authored = JSON.parse(readFileSync(join(pkgDir, "plugin.json"), "utf-8"));
delete authored._note;
const manifest = {
	...authored,
	entry: "./plugin.wasm",
	integrity: `sha256-${digest.hex}`,
};

const result = validatePluginManifest(manifest);
if (!result.valid) {
	console.error("[write-plugin-manifest] manifest is INVALID:", result.errors);
	process.exit(1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const verbs = Object.keys(manifest.capabilities?.verbs?.list ?? {});
console.log(
	`[write-plugin-manifest] wrote ${manifestPath} (key ${manifest.capabilities?.verbs?.key}, verbs: ${verbs.join(", ")}, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
