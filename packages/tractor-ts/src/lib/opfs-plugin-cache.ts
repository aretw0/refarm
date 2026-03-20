/**
 * OPFS Plugin Cache
 *
 * Stores compiled WASM binaries in the browser's Origin Private File System.
 * This provides persistent, efficient binary storage without network round-trips.
 *
 * Browser only — this file must NOT be imported from Node.js paths.
 */

const CACHE_DIR = "refarm-plugins";

async function getCacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CACHE_DIR, { create: true });
}

/**
 * Store a WASM buffer in OPFS for a given plugin ID.
 */
export async function cachePlugin(pluginId: string, buffer: ArrayBuffer): Promise<void> {
  const dir = await getCacheDir();
  const safeName = pluginId.replace(/[^a-z0-9_-]/gi, "_") + ".wasm";
  const fileHandle = await dir.getFileHandle(safeName, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(buffer);
  await writable.close();
}

/**
 * Retrieve a cached WASM buffer for a given plugin ID.
 * Returns null if not cached.
 */
export async function getCachedPlugin(pluginId: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await getCacheDir();
    const safeName = pluginId.replace(/[^a-z0-9_-]/gi, "_") + ".wasm";
    const fileHandle = await dir.getFileHandle(safeName);
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Remove a cached plugin from OPFS.
 */
export async function evictPlugin(pluginId: string): Promise<void> {
  try {
    const dir = await getCacheDir();
    const safeName = pluginId.replace(/[^a-z0-9_-]/gi, "_") + ".wasm";
    await dir.removeEntry(safeName);
  } catch {
    // Already evicted or never cached — no-op
  }
}
