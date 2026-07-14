// Emit dist/plugin.json — the runtime PluginManifest that ships ALONGSIDE the built
// identity_provider.wasm, so the tractor host's read_runtime_plugin_manifest (which
// looks for a plugin.json next to the .wasm) knows the plugin's ENTRY, its verbs
// (identity:whoami), and its providesApi (identity:v1). The host's get_identity
// resolves this plugin via that providesApi and dispatches identity:whoami to it.
//
// Mirrors packages/lsp-code-ops/scripts/write-plugin-manifest.mjs: take the authored
// ./plugin.json, strip the `_note`, and stamp entry + integrity (sha256 of the real
// built bytes). Run as the last step of build:wasm, after the .wasm exists.

import { computeSha256Digest, validatePluginManifest } from "@refarm.dev/plugin-manifest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const distDir = join(pkgDir, "dist");
const wasmPath = join(distDir, "identity_provider.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const authored = JSON.parse(readFileSync(join(pkgDir, "plugin.json"), "utf-8"));
delete authored._note;
const manifest = {
	...authored,
	entry: "./identity_provider.wasm",
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
	`[write-plugin-manifest] wrote ${manifestPath} (key ${manifest.capabilities?.verbs?.key}, verbs: ${verbs.join(", ")}, providesApi: ${(manifest.capabilities?.providesApi ?? []).join(", ")}, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
