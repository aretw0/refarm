import fs from "node:fs/promises";
import path from "node:path";
import type { PluginBinaryCacheAdapter } from "@refarm.dev/plugin-manifest";

export function createFilesystemCacheAdapter(
  baseDir: string,
): PluginBinaryCacheAdapter {
  function wasmPath(pluginId: string): string {
    return path.join(baseDir, pluginId, "plugin.wasm");
  }

  return {
    async get(pluginId: string): Promise<ArrayBuffer | null> {
      try {
        const buf = await fs.readFile(wasmPath(pluginId));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch {
        return null;
      }
    },

    async set(pluginId: string, bytes: ArrayBuffer): Promise<void> {
      const dir = path.join(baseDir, pluginId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(wasmPath(pluginId), Buffer.from(bytes));
    },

    async evict(pluginId: string): Promise<void> {
      const dir = path.join(baseDir, pluginId);
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
