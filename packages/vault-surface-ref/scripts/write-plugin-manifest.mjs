// Emit dist/plugin.json — the runtime PluginManifest that ships ALONGSIDE the
// built vault_plugin.wasm, so the tractor host's read_runtime_plugin_manifest
// finds it (it looks for plugin.json next to the .wasm) and knows the plugin's
// entry + advertised capabilities. Closes two loose ends at once:
//   1. a manifest ships with the component (nothing did before), and
//   2. the integrity SHA-256 is computed from the REAL built .wasm and stamped,
//      so validatePluginManifest stops rejecting the unstamped .wasm entry.
//
// Run as the last step of `build:plugin`, after the .wasm exists.

import {
	buildVaultPluginManifest,
	VAULT_VERBS,
} from "@refarm.dev/vault-contract-v1";
import {
	computeSha256Digest,
	validatePluginManifest,
} from "@refarm.dev/plugin-manifest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const wasmPath = join(distDir, "vault_plugin.wasm");
const manifestPath = join(distDir, "plugin.json");

const bytes = readFileSync(wasmPath);
const digest = await computeSha256Digest(
	bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const manifest = buildVaultPluginManifest({
	id: "@refarm.dev/vault-surface-ref",
	name: "vault",
	// The entry sits next to plugin.json in dist/, so the path is relative to it.
	entry: "./vault_plugin.wasm",
	integrity: `sha256-${digest.hex}`,
});

const result = validatePluginManifest(manifest);
if (!result.valid) {
	console.error("[write-plugin-manifest] manifest is INVALID:", result.errors);
	process.exit(1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
	`[write-plugin-manifest] wrote ${manifestPath} (provides: ${VAULT_VERBS.map((v) => `vault:${v}`).join(", ")}, integrity sha256-${digest.hex.slice(0, 12)}…)`,
);
