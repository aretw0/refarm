// Emit dist/plugin.json for the source:v1 provider plugin — the runtime
// PluginManifest shipping alongside source_provider.wasm, integrity from the real
// binary. Mirrors quality-checker-plugin's script. This plugin serves its provider
// surface via `respond` (synchronous), so it declares the provider capability but
// subscribes to no dispatch event.
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
const wasmPath = join(distDir, "source_provider.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const manifest = {
	// The id suffix (after the last `/`) must equal metadata().name so the host
	// aligns manifest.id to the runtime name.
	id: "@refarm.dev/source-provider-ref",
	name: "source-provider-ref",
	version: "0.1.0",
	entry: "./source_provider.wasm",
	capabilities: {
		// Advertises the source:v1 provider surface. It serves via `respond`
		// (synchronous), not an event, so it subscribes to nothing.
		provides: ["source:v1"],
		requires: [],
		subscribes: [],
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
	`[write-plugin-manifest] wrote ${manifestPath} (provides: source:v1, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
