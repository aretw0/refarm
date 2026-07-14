// Emit dist/plugin.json — the runtime PluginManifest that ships ALONGSIDE the built
// scarecrow plugin.wasm, so the tractor host's read_runtime_plugin_manifest knows the
// plugin's ENTRY and that it declares `observe-host-effects` (the capability that makes
// the host register it as a host-effect observer and forward host-effect:* events to it).
//
// Mirrors packages/lsp-code-ops/scripts/write-plugin-manifest.mjs: take the authored
// ./plugin.json, strip the `_note`, and stamp entry + integrity (sha256 of the real bytes).

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
const manifest = { ...authored, entry: "./plugin.wasm", integrity: `sha256-${digest.hex}` };

const result = validatePluginManifest(manifest);
if (!result.valid) {
	console.error("[write-plugin-manifest] manifest is INVALID:", result.errors);
	process.exit(1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
	`[write-plugin-manifest] wrote ${manifestPath} (provides: ${(manifest.capabilities?.provides ?? []).join(", ")}, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
