/**
 * OPFS Plugin Cache
 *
 * Canonical layout (ADR hardening):
 * /refarm/barn/implements/<cache-key>.wasm
 * /refarm/barn/metadata/<cache-key>.json
 *
 * Browser-first with in-memory fallback for non-OPFS runtimes.
 */

import type { PluginArtifactMetadata } from "@refarm.dev/plugin-manifest";

const OPFS_ROOT_SEGMENT = "refarm";
const OPFS_BARN_SEGMENT = "barn";
const OPFS_IMPLEMENTS_SEGMENT = "implements";
const OPFS_METADATA_SEGMENT = "metadata";

const memoryCache = new Map<
	string,
	{ bytes: ArrayBuffer; metadata?: PluginArtifactMetadata }
>();

function hasOpfs(): boolean {
	return Boolean(globalThis.navigator?.storage?.getDirectory);
}

export function getPluginCacheKey(pluginId: string): string {
	return pluginId.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

export function getPluginCachePath(pluginId: string): string {
	return `/${OPFS_ROOT_SEGMENT}/${OPFS_BARN_SEGMENT}/${OPFS_IMPLEMENTS_SEGMENT}/${getPluginCacheKey(pluginId)}.wasm`;
}

function getPluginMetadataPath(pluginId: string): string {
	return `/${OPFS_ROOT_SEGMENT}/${OPFS_BARN_SEGMENT}/${OPFS_METADATA_SEGMENT}/${getPluginCacheKey(pluginId)}.json`;
}

async function getDir(
	pathSegments: string[],
): Promise<FileSystemDirectoryHandle> {
	let cursor = await navigator.storage.getDirectory();
	for (const segment of pathSegments) {
		cursor = await cursor.getDirectoryHandle(segment, { create: true });
	}
	return cursor;
}

async function getImplementsDir(): Promise<FileSystemDirectoryHandle> {
	return getDir([
		OPFS_ROOT_SEGMENT,
		OPFS_BARN_SEGMENT,
		OPFS_IMPLEMENTS_SEGMENT,
	]);
}

async function getMetadataDir(): Promise<FileSystemDirectoryHandle> {
	return getDir([OPFS_ROOT_SEGMENT, OPFS_BARN_SEGMENT, OPFS_METADATA_SEGMENT]);
}

/**
 * Store a WASM buffer in cache for a given plugin ID.
 */
export async function cachePlugin(
	pluginId: string,
	buffer: ArrayBuffer,
	metadata?: PluginArtifactMetadata,
): Promise<void> {
	if (!hasOpfs()) {
		memoryCache.set(pluginId, { bytes: buffer, metadata });
		return;
	}

	const key = getPluginCacheKey(pluginId);
	const implementsDir = await getImplementsDir();
	const fileHandle = await implementsDir.getFileHandle(`${key}.wasm`, {
		create: true,
	});
	const writable = await (fileHandle as any).createWritable();
	await writable.write(buffer);
	await writable.close();

	if (metadata) {
		const metadataDir = await getMetadataDir();
		const metadataHandle = await metadataDir.getFileHandle(`${key}.json`, {
			create: true,
		});
		const metadataWritable = await (metadataHandle as any).createWritable();
		await metadataWritable.write(JSON.stringify(metadata, null, 2));
		await metadataWritable.close();
	}
}

/**
 * Retrieve a cached WASM buffer for a given plugin ID.
 * Returns null if not cached.
 */
export async function getCachedPlugin(
	pluginId: string,
): Promise<ArrayBuffer | null> {
	if (!hasOpfs()) {
		return memoryCache.get(pluginId)?.bytes ?? null;
	}

	try {
		const key = getPluginCacheKey(pluginId);
		const implementsDir = await getImplementsDir();
		const fileHandle = await implementsDir.getFileHandle(`${key}.wasm`);
		const file = await fileHandle.getFile();
		return file.arrayBuffer();
	} catch {
		return null;
	}
}

/**
 * Retrieve cached metadata (if present) for a given plugin ID.
 */
export async function getCachedPluginMetadata(
	pluginId: string,
): Promise<PluginArtifactMetadata | null> {
	if (!hasOpfs()) {
		return memoryCache.get(pluginId)?.metadata ?? null;
	}

	try {
		const key = getPluginCacheKey(pluginId);
		const metadataDir = await getMetadataDir();
		const fileHandle = await metadataDir.getFileHandle(`${key}.json`);
		const file = await fileHandle.getFile();
		return JSON.parse(await file.text()) as PluginArtifactMetadata;
	} catch {
		return null;
	}
}

/**
 * Remove a cached plugin from cache.
 */
export async function evictPlugin(pluginId: string): Promise<void> {
	if (!hasOpfs()) {
		memoryCache.delete(pluginId);
		return;
	}

	const key = getPluginCacheKey(pluginId);
	try {
		const implementsDir = await getImplementsDir();
		await implementsDir.removeEntry(`${key}.wasm`);
	} catch {
		// Already evicted or never cached — no-op
	}

	try {
		const metadataDir = await getMetadataDir();
		await metadataDir.removeEntry(`${key}.json`);
	} catch {
		// Metadata not found — no-op
	}
}

export const OPFS_LAYOUT = {
	root: `/${OPFS_ROOT_SEGMENT}/${OPFS_BARN_SEGMENT}`,
	implements: `/${OPFS_ROOT_SEGMENT}/${OPFS_BARN_SEGMENT}/${OPFS_IMPLEMENTS_SEGMENT}`,
	metadata: `/${OPFS_ROOT_SEGMENT}/${OPFS_BARN_SEGMENT}/${OPFS_METADATA_SEGMENT}`,
} as const;
