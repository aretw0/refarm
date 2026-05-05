const SHA256_PREFIX = "sha256-";

export const SHA256_HEX_VALUE_RE = /^[0-9a-fA-F]{64}$/;
export const SHA256_BASE64_VALUE_RE =
	/^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{43})$/;

/**
 * @typedef {{ algorithm: 'sha256'; encoding: 'hex'|'base64'; value: string }} ParsedIntegrity
 * @typedef {{ base64: string; hex: string }} Sha256Digest
 */

function getSubtleCrypto() {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error(
			"Web Crypto API (crypto.subtle) is required for SHA-256 verification",
		);
	}
	return subtle;
}

function bytesToHex(bytes) {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function bytesToBase64(bytes) {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}

	if (typeof btoa !== "function") {
		throw new Error("Base64 encoder unavailable in current runtime");
	}

	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * @param {string} integrity
 * @returns {ParsedIntegrity}
 */
export function parseSha256Integrity(integrity) {
	const normalized = integrity?.trim?.() ?? "";
	if (!normalized.startsWith(SHA256_PREFIX)) {
		throw new Error(
			`Integrity must use ${SHA256_PREFIX} prefix (received: "${integrity}")`,
		);
	}

	const value = normalized.slice(SHA256_PREFIX.length);
	if (!value) {
		throw new Error("Integrity digest is empty");
	}

	if (SHA256_HEX_VALUE_RE.test(value)) {
		return {
			algorithm: "sha256",
			encoding: "hex",
			value: value.toLowerCase(),
		};
	}

	if (SHA256_BASE64_VALUE_RE.test(value)) {
		return {
			algorithm: "sha256",
			encoding: "base64",
			value,
		};
	}

	throw new Error(
		"Integrity digest must be 64-char hex or base64 sha256 value",
	);
}

/**
 * @param {ArrayBuffer} bytes
 * @returns {Promise<Sha256Digest>}
 */
export async function computeSha256Digest(bytes) {
	const subtle = getSubtleCrypto();
	const digestBuffer = await subtle.digest("SHA-256", bytes);
	const digestBytes = new Uint8Array(digestBuffer);

	return {
		base64: bytesToBase64(digestBytes),
		hex: bytesToHex(digestBytes),
	};
}

/**
 * @param {ParsedIntegrity} expected
 * @param {Sha256Digest} actual
 * @returns {boolean}
 */
export function isSha256DigestMatch(expected, actual) {
	if (expected.encoding === "hex") {
		return expected.value === actual.hex;
	}
	return expected.value === actual.base64;
}

/**
 * @param {ArrayBuffer} bytes
 * @param {string} integrity
 * @returns {Promise<Sha256Digest>}
 */
export async function verifyBufferIntegrity(bytes, integrity) {
	const parsed = parseSha256Integrity(integrity);
	const digest = await computeSha256Digest(bytes);

	if (!isSha256DigestMatch(parsed, digest)) {
		throw new Error(
			`Integrity check failed: expected ${integrity}, got ${SHA256_PREFIX}${digest.base64}`,
		);
	}

	return digest;
}
