import { parseSha256Integrity, verifyBufferIntegrity } from "./integrity.js";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const WASM_MODULE_VERSION = [0x01, 0x00, 0x00, 0x00];
const WASM_COMPONENT_VERSION = [0x0a, 0x00, 0x01, 0x00];

export const WASM_BINARY_KINDS = Object.freeze([
	"module",
	"component",
	"unknown",
]);

/**
 * @param {ArrayBuffer} bytes
 * @returns {"module"|"component"|"unknown"}
 */
export function detectWasmBinaryKind(bytes) {
	if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 8) {
		return "unknown";
	}

	const header = new Uint8Array(bytes, 0, 8);
	const magicOk = WASM_MAGIC.every((value, index) => header[index] === value);
	if (!magicOk) return "unknown";

	const version = Array.from(header.slice(4, 8));
	if (version.every((value, index) => value === WASM_MODULE_VERSION[index])) {
		return "module";
	}

	if (
		version.every((value, index) => value === WASM_COMPONENT_VERSION[index])
	) {
		return "component";
	}

	return "unknown";
}

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
 * @property {"module"|"component"|"unknown"} artifactKind
 * @property {{url: string, integrity: string, format: "esm"}} [browserRuntimeModule]
 * @property {{schemaVersion: 1, descriptorHash: string, componentWasmUrl: string, source: "descriptor"|"direct"}} [browserRuntimeDescriptor]
 * @property {{name: string, version: string, generatedAt?: string}} [browserRuntimeToolchain]
 * @property {{source: "descriptor"|"direct", commitSha: string, buildId: string, sourceRepository?: string}} [browserRuntimeProvenance]
 */

/**
 * @typedef {Object} InstallWasmArtifactRequest
 * @property {string} pluginId
 * @property {string} wasmUrl
 * @property {string} integrity
 * @property {boolean} [force]
 * @property {Record<string, unknown>} [metadataExtensions]
 */

/**
 * @typedef {Object} InstallWasmArtifactResult
 * @property {string} pluginId
 * @property {string} wasmUrl
 * @property {boolean} cached
 * @property {number} byteLength
 * @property {string} wasmHash
 * @property {"module"|"component"|"unknown"} artifactKind
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
	const metadataExtensions =
		request?.metadataExtensions &&
		typeof request.metadataExtensions === "object" &&
		!Array.isArray(request.metadataExtensions)
			? request.metadataExtensions
			: undefined;
	const cache = deps?.cache;
	const fetchFn = deps?.fetchFn ?? globalThis.fetch;

	const buildMetadata = (wasmHash, artifactKind) => ({
		pluginId,
		wasmUrl,
		integrity,
		wasmHash,
		cachedAt: Date.now(),
		artifactKind,
		...(metadataExtensions ?? {}),
	});

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
				const artifactKind = detectWasmBinaryKind(cached);
				const wasmHash = `sha256-${digest.base64}`;

				if (metadataExtensions) {
					await cache.set(
						pluginId,
						cached,
						buildMetadata(wasmHash, artifactKind),
					);
				}

				return {
					pluginId,
					wasmUrl,
					cached: true,
					byteLength: cached.byteLength,
					wasmHash,
					artifactKind,
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
	const artifactKind = detectWasmBinaryKind(bytes);

	await cache.set(pluginId, bytes, buildMetadata(wasmHash, artifactKind));

	return {
		pluginId,
		wasmUrl,
		cached: false,
		byteLength: bytes.byteLength,
		wasmHash,
		artifactKind,
	};
}
