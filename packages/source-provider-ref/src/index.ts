import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Host-side pointers for the source:v1 provider plugin. The provider itself is the
 * built WASM component (`dist/source_provider.wasm`) that exports the canonical
 * `integration` interface and serves its source methods synchronously via `respond`
 * — the host loads it and calls `respond(JSON{method,...})`, no import of provider
 * code. This module only locates the artifact + manifest for a loader/test.
 */

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

/** The built provider component. */
export const SOURCE_PROVIDER_WASM_PATH = join(distDir, "source_provider.wasm");

/** The generated runtime manifest (id, provides: source:v1, integrity). */
export const SOURCE_PROVIDER_MANIFEST_PATH = join(distDir, "plugin.json");

/** Read the generated manifest, if the plugin has been built. */
export function readSourceProviderManifest(): unknown {
	return JSON.parse(readFileSync(SOURCE_PROVIDER_MANIFEST_PATH, "utf-8"));
}

/** The method-routed request shape a caller sends to the provider's `respond`. */
export interface SourceProviderRequest {
	method: "discover" | "status" | "capability";
	ref?: string;
}
