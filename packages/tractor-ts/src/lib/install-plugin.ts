/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { cachePlugin, evictPlugin, getCachedPlugin } from "./opfs-plugin-cache";

const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const SHA256_BASE64_RE = /^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{43})$/;

type IntegrityDigest =
	| { kind: "hex"; value: string }
	| { kind: "base64"; value: string };

type ShaDigest = {
	base64: string;
	hex: string;
};

function parseIntegrity(integrityString: string): IntegrityDigest {
	if (!integrityString.startsWith("sha256-")) {
		throw new Error(
			`[installPlugin] Unsupported integrity algorithm in "${integrityString}". Only sha256- is supported.`,
		);
	}

	const value = integrityString.slice(7);
	if (SHA256_HEX_RE.test(value)) {
		return { kind: "hex", value: value.toLowerCase() };
	}
	if (SHA256_BASE64_RE.test(value)) {
		return { kind: "base64", value };
	}

	throw new Error(
		`[installPlugin] Invalid SHA-256 digest in "${integrityString}". Expected 64-char hex or base64 value.`,
	);
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function computeSha256(buffer: ArrayBuffer): Promise<ShaDigest> {
	const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
	const hashBytes = new Uint8Array(hashBuffer);
	let binaryString = "";
	for (const byte of hashBytes) binaryString += String.fromCharCode(byte);

	return {
		base64: btoa(binaryString),
		hex: bytesToHex(hashBytes),
	};
}

function isDigestMatch(expected: IntegrityDigest, actual: ShaDigest): boolean {
	if (expected.kind === "hex") {
		return expected.value === actual.hex;
	}
	return expected.value === actual.base64;
}

/**
 * Verify the SHA-256 integrity of a WASM buffer against a manifest's
 * integrity string (W3C SRI format: "sha256-<base64>").
 * Throws if the hash doesn't match.
 */
async function verifyIntegrity(
	buffer: ArrayBuffer,
	integrityString: string,
): Promise<void> {
	const expected = parseIntegrity(integrityString);
	const actual = await computeSha256(buffer);

	if (!isDigestMatch(expected, actual)) {
		throw new Error(
			`[installPlugin] Integrity check failed: expected ${integrityString}, got sha256-${actual.base64}`,
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
	options: { force?: boolean } = {},
): Promise<InstallPluginResult> {
	const pluginId = manifest.id;

	if (!manifest.integrity) {
		throw new Error(
			`[installPlugin] Missing manifest.integrity for ${pluginId}. sha256- digest is required.`,
		);
	}

	if (!options.force) {
		const cached = await getCachedPlugin(pluginId);
		if (cached) {
			try {
				await verifyIntegrity(cached, manifest.integrity);
				return {
					pluginId,
					wasmUrl,
					cached: true,
					byteLength: cached.byteLength,
				};
			} catch {
				await evictPlugin(pluginId);
			}
		}
	}

	const response = await fetch(wasmUrl);
	if (!response.ok) {
		throw new Error(
			`[installPlugin] Failed to fetch ${wasmUrl}: ${response.statusText}`,
		);
	}

	const buffer = await response.arrayBuffer();

	await verifyIntegrity(buffer, manifest.integrity);

	await cachePlugin(pluginId, buffer);

	return { pluginId, wasmUrl, cached: false, byteLength: buffer.byteLength };
}
