// Emit dist/plugin.json for the enrichment:v1 provider plugin — the runtime
// PluginManifest shipping alongside enrichment_provider.wasm, integrity from the real
// binary. Mirrors source-provider-ref's script. This plugin serves its provider surface
// via `respond` (synchronous), so it declares the provider capability but subscribes to
// no dispatch event.
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
const wasmPath = join(distDir, "enrichment_provider.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const manifest = {
	// The id suffix (after the last `/`) must equal metadata().name so the host aligns
	// manifest.id to the runtime name.
	id: "@refarm.dev/enrichment-provider-ref",
	name: "enrichment-provider-ref",
	version: "0.1.0",
	entry: "./enrichment_provider.wasm",
	capabilities: {
		// The verbs this provider OFFERS. `enrichment:v1` marks the capability family;
		// `enrichment:enrich` is the I/O-shaped method the adapter marshals via respond.
		provides: ["enrichment:v1", "enrichment:enrich", "enrichment:describe", "enrichment:capability"],
		requires: [],
		// It serves those verbs SYNCHRONOUSLY via `respond` (ADR-084): the sync mode is a
		// per-verb attribute of `provides`. It subscribes to no event.
		syncVerbs: ["enrichment:enrich", "enrichment:describe", "enrichment:capability"],
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
	`[write-plugin-manifest] wrote ${manifestPath} (provides: enrichment:v1, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
