import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Host-side pointers for the enrichment:v1 provider plugin. The provider itself is the
 * built WASM component (`dist/enrichment_provider.wasm`) that exports the canonical
 * `integration` interface and serves its enrichment lookup synchronously via `respond`
 * — the host loads it and calls `respond(JSON{method:"enrich",...})`, no import of
 * provider code. This module only locates the artifact + manifest for a loader/test.
 */

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

/** The built provider component. */
export const ENRICHMENT_PROVIDER_WASM_PATH = join(distDir, "enrichment_provider.wasm");

/** The generated runtime manifest (id, provides: enrichment:v1, integrity). */
export const ENRICHMENT_PROVIDER_MANIFEST_PATH = join(distDir, "plugin.json");
