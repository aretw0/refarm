/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { cachePlugin, getCachedPlugin } from "./opfs-plugin-cache";

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
  await cachePlugin(pluginId, buffer);

  return { pluginId, wasmUrl, cached: false, byteLength: buffer.byteLength };
}
