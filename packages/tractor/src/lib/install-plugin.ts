/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { cachePlugin, getCachedPlugin } from "./opfs-plugin-cache";

/**
 * Verify the SHA-256 integrity of a WASM buffer against a manifest's
 * integrity string (W3C SRI format: "sha256-<base64>").
 * Throws if the hash doesn't match.
 */
async function verifyIntegrity(buffer: ArrayBuffer, integrityString: string): Promise<void> {
  if (!integrityString.startsWith("sha256-")) {
    throw new Error(
      `[installPlugin] Unsupported integrity algorithm in "${integrityString}". Only sha256- is supported.`
    );
  }
  const expected = integrityString.slice(7); // strip "sha256-" prefix
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const hashBytes = new Uint8Array(hashBuffer);
  let binaryString = "";
  for (const byte of hashBytes) binaryString += String.fromCharCode(byte);
  const actual = btoa(binaryString);
  if (actual !== expected) {
    throw new Error(
      `[installPlugin] Integrity check failed: expected sha256-${expected}, got sha256-${actual}`
    );
  }
}

export interface InstallPluginResult {
  pluginId: string;
  wasmUrl: string;
  cached: boolean;
  byteLength: number;
}

/**
 * Install a plugin by fetching its WASM and caching it to OPFS.
 *
 * If the plugin is already cached, returns the cached version without re-fetching.
 * Pass force: true to bypass the cache and re-fetch.
 */
export async function installPlugin(
  manifest: PluginManifest,
  wasmUrl: string,
  options: { force?: boolean } = {}
): Promise<InstallPluginResult> {
  const pluginId = manifest.id;

  if (!options.force) {
    const cached = await getCachedPlugin(pluginId);
    if (cached) {
      return { pluginId, wasmUrl, cached: true, byteLength: cached.byteLength };
    }
  }

  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`[installPlugin] Failed to fetch ${wasmUrl}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();

  if (manifest.integrity) {
    await verifyIntegrity(buffer, manifest.integrity);
  }

  await cachePlugin(pluginId, buffer);

  return { pluginId, wasmUrl, cached: false, byteLength: buffer.byteLength };
}
