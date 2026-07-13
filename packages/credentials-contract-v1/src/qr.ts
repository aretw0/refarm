import type { VerifiableCredential } from "./types.js";

/**
 * QR CREDENTIAL import — turn what a QR code carries into a Verifiable Credential. A wallet's
 * "scan to import" is the citizen-facing on-ramp; this is the substrate half: the pure DECODE of
 * the QR's TEXT payload into VC JSON. The image→text step (scanning a PNG) needs a platform
 * decoder (a browser BarcodeDetector, a native lib), so it is an INJECTED seam — this contract
 * stays dependency-free and the consumer brings the scanner.
 *
 * A QR in a credential wallet carries the VC one of a few ways; this normalizes all of them:
 *  - raw VC JSON (the whole credential inline),
 *  - base64url-encoded VC JSON (compact — the common QR encoding),
 *  - a credential-offer URL whose query carries the credential (or a base64url one).
 */

/** Why a QR payload could not be turned into a credential. */
export type QrDecodeError = "empty" | "not-a-credential" | "unsupported-encoding";

export interface QrDecodeResult {
	ok: boolean;
	credential?: VerifiableCredential;
	error?: QrDecodeError;
	/** The raw JSON text the payload decoded to (for the caller to hash/store), when ok. */
	json?: string;
}

/** Decode a base64url string to UTF-8, or null if it isn't valid base64url. */
function fromBase64Url(value: string): string | null {
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length < 8) return null;
	const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
	try {
		// atob in the browser / Buffer in node — prefer the standard atob, fall back to Buffer.
		const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
		// Re-decode as UTF-8 (a credential may hold multibyte chars).
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function isCredentialShape(value: unknown): value is VerifiableCredential {
	if (!value || typeof value !== "object") return false;
	const vc = value as Record<string, unknown>;
	return typeof vc.issuer === "string" && typeof vc.credentialSubject === "object" && vc.credentialSubject !== null;
}

/** Try to parse a string as VC JSON (the shape guard mirrors parseCredentialFile). */
function tryJson(text: string): VerifiableCredential | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		return isCredentialShape(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Decode a QR code's TEXT payload into a Verifiable Credential. Handles raw VC JSON, base64url-
 * encoded VC JSON, and a credential-offer URL carrying the credential in a `credential` /
 * `credential_offer` query param (raw or base64url). PURE — no I/O, no scanner. Returns the
 * credential + its canonical JSON text, or a structured error.
 */
export function decodeCredentialQrPayload(payload: string): QrDecodeResult {
	const text = payload.trim();
	if (!text) return { ok: false, error: "empty" };

	// 1. Raw VC JSON.
	const direct = tryJson(text);
	if (direct) return { ok: true, credential: direct, json: JSON.stringify(direct) };

	// 2. A credential-offer URL: pull the credential from a known query param.
	const fromUrl = credentialFromUrl(text);
	if (fromUrl) return { ok: true, credential: fromUrl, json: JSON.stringify(fromUrl) };

	// 3. base64url-encoded VC JSON.
	const decoded = fromBase64Url(text);
	if (decoded) {
		const vc = tryJson(decoded);
		if (vc) return { ok: true, credential: vc, json: JSON.stringify(vc) };
		return { ok: false, error: "not-a-credential" };
	}

	return { ok: false, error: "unsupported-encoding" };
}

/** Extract a credential from a URL's `credential` / `credential_offer` query param (raw JSON or
 * base64url). Returns null if the string isn't a URL or carries no credential. */
function credentialFromUrl(text: string): VerifiableCredential | null {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	for (const key of ["credential", "credential_offer", "vc"]) {
		const raw = url.searchParams.get(key);
		if (!raw) continue;
		const direct = tryJson(raw);
		if (direct) return direct;
		const decoded = fromBase64Url(raw);
		if (decoded) {
			const vc = tryJson(decoded);
			if (vc) return vc;
		}
	}
	return null;
}

/** Decode an image to its QR text — the INJECTED scanner seam (a browser BarcodeDetector, a
 * native lib). The substrate ships no scanner; a consumer provides one and pipes its text into
 * `decodeCredentialQrPayload`. Typed here so the seam is part of the contract. */
export type QrImageDecoder = (image: Uint8Array) => Promise<string | null> | string | null;

/**
 * Scan an image and decode the credential in one call, given an injected image decoder. The
 * substrate composes the two halves (scan → decode); the consumer only brings the scanner.
 */
export async function scanCredentialQr(image: Uint8Array, decode: QrImageDecoder): Promise<QrDecodeResult> {
	const text = await decode(image);
	if (!text) return { ok: false, error: "empty" };
	return decodeCredentialQrPayload(text);
}
