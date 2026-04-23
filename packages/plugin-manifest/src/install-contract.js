import { parseSha256Integrity, verifyBufferIntegrity } from "./integrity.js";

/**
 * @typedef {Object} PluginBinaryCacheAdapter
 * @property {(pluginId: string) => Promise<ArrayBuffer | null>} get
 * @property {(pluginId: string, bytes: ArrayBuffer, metadata?: PluginArtifactMetadata) => Promise<void>} set
 * @property {(pluginId: string) => Promise<void>} evict
 */

/**
 * @typedef {Object} PluginArtifactMetadata
 * @property {string} pluginId
 * @property {string} wasmUrl
 * @property {string} integrity
 * @property {string} wasmHash
 * @property {number} cachedAt
 */

/**
 * @typedef {Object} InstallWasmArtifactRequest
 * @property {string} pluginId
 * @property {string} wasmUrl
 * @property {string} integrity
 * @property {boolean} [force]
 */

/**
 * @typedef {Object} InstallWasmArtifactResult
 * @property {string} pluginId
 * @property {string} wasmUrl
 * @property {boolean} cached
 * @property {number} byteLength
 * @property {string} wasmHash
 */

/**
 * @param {InstallWasmArtifactRequest} request
 * @param {{ cache: PluginBinaryCacheAdapter; fetchFn?: typeof fetch }} deps
 * @returns {Promise<InstallWasmArtifactResult>}
 */
export async function installWasmArtifact(request, deps) {
	const pluginId = request?.pluginId?.trim?.();
	const wasmUrl = request?.wasmUrl;
	const integrity = request?.integrity;
	const force = Boolean(request?.force);
	const cache = deps?.cache;
	const fetchFn = deps?.fetchFn ?? globalThis.fetch;

	if (!pluginId) {
		throw new Error("[install-contract] pluginId is required");
	}

	if (!wasmUrl) {
		throw new Error("[install-contract] wasmUrl is required");
	}

	if (!integrity) {
		throw new Error(
			`[install-contract] Missing integrity for ${pluginId}. sha256- digest is required.`,
		);
	}

	if (!cache?.get || !cache?.set || !cache?.evict) {
		throw new Error(
			"[install-contract] cache adapter must implement get/set/evict",
		);
	}

	if (typeof fetchFn !== "function") {
		throw new Error("[install-contract] fetchFn is required");
	}

	// Fail-fast on malformed integrity before touching cache/fetch paths.
	parseSha256Integrity(integrity);

	if (!force) {
		const cached = await cache.get(pluginId);
		if (cached) {
			try {
				const digest = await verifyBufferIntegrity(cached, integrity);
				return {
					pluginId,
					wasmUrl,
					cached: true,
					byteLength: cached.byteLength,
					wasmHash: `sha256-${digest.base64}`,
				};
			} catch {
				await cache.evict(pluginId);
			}
		}
	}

	const response = await fetchFn(wasmUrl);
	if (!response.ok) {
		throw new Error(
			`[install-contract] Failed to fetch ${wasmUrl}: ${response.statusText}`,
		);
	}

	const bytes = await response.arrayBuffer();
	const digest = await verifyBufferIntegrity(bytes, integrity);
	const wasmHash = `sha256-${digest.base64}`;

	await cache.set(pluginId, bytes, {
		pluginId,
		wasmUrl,
		integrity,
		wasmHash,
		cachedAt: Date.now(),
	});

	return {
		pluginId,
		wasmUrl,
		cached: false,
		byteLength: bytes.byteLength,
		wasmHash,
	};
}
