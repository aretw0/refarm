// Emit dist/plugin.json for the quality integration plugin — the runtime
// PluginManifest that ships alongside the built quality_plugin.wasm, with the
// integrity SHA-256 computed from the real binary. Mirrors vault-surface-ref's
// script; the quality plugin advertises the single `quality:check` verb.
//
// Run as the last step of `build:plugin`, after the .wasm exists.

import {
	computeSha256Digest,
	validatePluginManifest,
} from "@refarm.dev/plugin-manifest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const wasmPath = join(distDir, "quality_plugin.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const manifest = {
	id: "@refarm.dev/quality-checker-plugin",
	name: "quality",
	version: "0.1.0",
	entry: "./quality_plugin.wasm",
	capabilities: {
		provides: ["quality:check"],
		requires: [],
	},
	permissions: [],
	observability: {
		hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
	},
	targets: ["server"],
	certification: {
		license: "MIT",
		a11yLevel: 0,
		languages: ["en"],
	},
	integrity: `sha256-${digest.hex}`,
};

const result = validatePluginManifest(manifest);
if (!result.valid) {
	console.error("[write-plugin-manifest] manifest is INVALID:", result.errors);
	process.exit(1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
	`[write-plugin-manifest] wrote ${manifestPath} (provides: quality:check, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
