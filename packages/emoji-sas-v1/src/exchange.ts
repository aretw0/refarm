/**
 * S1 — P-256 ECDH through WebCrypto, and the derivation on top of it.
 *
 * WHY P-256 AND NOT X25519. X25519 is the nicer curve and its WebCrypto support is
 * still uneven across browsers; choosing it would trade a real portability problem for
 * a marginal aesthetic gain. P-256 ECDH is present in every current browser and in
 * Node with ZERO dependencies, which is the property that matters when the same code
 * has to run in a page, on the node, and in a kit that installs nothing. If browser
 * support settles, `SAS_CURVE` is one constant, not a redesign.
 *
 * WHY `crypto.subtle` AND NOT `node:crypto`. The repo already states the posture
 * (`asset-resolver-contract-v1`): `crypto.subtle` in the browser, Node's crypto on the
 * server — and Node has exposed the same `globalThis.crypto.subtle` since 20, so ONE
 * call site covers both. An import of `node:crypto` here would make this block
 * unimportable from a page.
 *
 * EVERY EXPORT IS ASYNC because WebCrypto is. Nothing here touches the filesystem, the
 * network, or a clock.
 */

import { fromBase64Url, toBase64Url } from "./base64url.js";
import {
	SAS_EMOJI_COUNT,
	sasEmojiFromIndices,
	sasIndicesFromBytes,
	type SasEmoji,
} from "./emoji.js";
import {
	checkSasTranscript,
	encodeSasTranscript,
	SAS_EMOJI_LABEL,
	SAS_SEAL_LABEL,
	type SasTranscript,
} from "./transcript.js";

/** The wire discriminator for everything this block puts on an HTTP body. */
export const SAS_WIRE = "emoji-sas.v1" as const;

/** One constant, so swapping curves later is a one-line change rather than a redesign. */
export const SAS_CURVE = "P-256" as const;

/** Raw (uncompressed) P-256 public key: `0x04 || X(32) || Y(32)`. */
const RAW_PUBLIC_KEY_BYTES = 65;

function subtle(): SubtleCrypto {
	const web = globalThis.crypto;
	if (!web?.subtle) {
		throw new Error(
			"emoji-sas: this runtime exposes no WebCrypto (globalThis.crypto.subtle). " +
				"Node 20+ and every current browser do; there is no fallback on purpose.",
		);
	}
	return web.subtle;
}

/** An ephemeral keypair for ONE exchange. The private key is `extractable` so a
 *  confirming side can hand it across a process boundary (see the filesystem-backed
 *  store in the CLI); a browser never needs to and should never make it so. */
export interface SasKeyPair {
	/** base64url of the raw public key — what goes on the wire. */
	readonly publicKey: string;
	readonly privateKey: CryptoKey;
}

export async function generateSasKeyPair(options: { extractable?: boolean } = {}): Promise<SasKeyPair> {
	const pair = (await subtle().generateKey(
		{ name: "ECDH", namedCurve: SAS_CURVE },
		options.extractable ?? false,
		["deriveBits"],
	)) as CryptoKeyPair;
	const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
	return { publicKey: toBase64Url(raw), privateKey: pair.privateKey };
}

/**
 * Import a peer's public key off the wire.
 *
 * The length check is not belt-and-braces: `importKey` accepts several encodings, and
 * accepting a *compressed* point here would mean the two sides could encode the same
 * key two ways — same secret, different transcript, different emoji, and a "mismatch"
 * that is our own bug rather than an attacker. One encoding, enforced.
 */
export async function importSasPublicKey(publicKey: string): Promise<CryptoKey> {
	const raw = fromBase64Url(publicKey);
	if (raw.length !== RAW_PUBLIC_KEY_BYTES || raw[0] !== 0x04) {
		throw new SyntaxError(
			`emoji-sas: expected a ${RAW_PUBLIC_KEY_BYTES}-byte uncompressed P-256 point, got ${raw.length} bytes`,
		);
	}
	return subtle().importKey("raw", raw as BufferSource, { name: "ECDH", namedCurve: SAS_CURVE }, false, []);
}

export async function exportSasPrivateKey(privateKey: CryptoKey): Promise<JsonWebKey> {
	return subtle().exportKey("jwk", privateKey);
}

export async function importSasPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: SAS_CURVE }, true, ["deriveBits"]);
}

/** The raw ECDH output. PRIVATE to this module: nothing outside may see it, and in
 *  particular nothing may derive a short string straight from it (that is the S2
 *  mistake this file exists to make unreachable). */
async function sharedSecret(privateKey: CryptoKey, peerPublicKey: string): Promise<Uint8Array> {
	const peer = await importSasPublicKey(peerPublicKey);
	const bits = await subtle().deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
	return new Uint8Array(bits);
}

/**
 * HKDF-SHA256 over the shared secret, with the TRANSCRIPT as `info`.
 *
 * No salt: the transcript already carries a fresh session id, both public keys, and a
 * domain label, so the derivation is bound to this exchange and this purpose without
 * one. Adding a salt would need both sides to agree on it — one more thing to disagree
 * about, buying nothing the info parameter is not already buying.
 */
async function deriveBitsFromTranscript(
	privateKey: CryptoKey,
	peerPublicKey: string,
	transcript: SasTranscript,
	label: string,
	bits: number,
): Promise<Uint8Array> {
	const refusal = checkSasTranscript(transcript);
	if (refusal) throw new Error(`emoji-sas: ${refusal}`);
	if (peerPublicKey !== transcript.initiatorPublicKey && peerPublicKey !== transcript.confirmerPublicKey) {
		// The peer we are actually talking to must be one of the two the transcript
		// names. Without this a caller could derive over a transcript describing an
		// exchange that is not the one in front of them — the S2 failure, arrived at
		// by a different road.
		throw new Error("emoji-sas: the peer's public key is not in the transcript");
	}
	const secret = await sharedSecret(privateKey, peerPublicKey);
	const material = await subtle().importKey("raw", secret as BufferSource, "HKDF", false, ["deriveBits"]);
	const derived = await subtle().deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(0) as BufferSource,
			info: encodeSasTranscript(transcript, label) as BufferSource,
		},
		material,
		bits,
	);
	return new Uint8Array(derived);
}

export interface DeriveSasOptions {
	/** OUR ephemeral private key. */
	readonly privateKey: CryptoKey;
	/** THEIR public key, base64url — must be one of the two the transcript names. */
	readonly peerPublicKey: string;
	readonly transcript: SasTranscript;
}

/**
 * THE short authentication string: seven emoji from Matrix's sixty-four.
 *
 * Both sides call this with their own private key and the other's public key over the
 * SAME transcript, and get the same row. A relay in the middle cannot: it holds two
 * different transcripts, and the rows diverge.
 */
export async function deriveSasEmoji(options: DeriveSasOptions): Promise<SasEmoji[]> {
	// 48 bits of material for 42 bits of comparison — `sasIndicesFromBytes` reads six
	// bytes and discards the trailing six bits, exactly as Matrix does.
	const bytes = await deriveBitsFromTranscript(
		options.privateKey,
		options.peerPublicKey,
		options.transcript,
		SAS_EMOJI_LABEL,
		48,
	);
	const emoji = sasEmojiFromIndices(sasIndicesFromBytes(bytes));
	if (emoji.length !== SAS_EMOJI_COUNT) {
		throw new Error(`emoji-sas: derived ${emoji.length} emoji, expected ${SAS_EMOJI_COUNT}`);
	}
	return emoji;
}

/** The AES-GCM key the credential travels under. Derived from the same secret and the
 *  same transcript, under a DIFFERENT label — see `SAS_SEAL_LABEL`. */
async function sealingKey(options: DeriveSasOptions): Promise<CryptoKey> {
	const bytes = await deriveBitsFromTranscript(
		options.privateKey,
		options.peerPublicKey,
		options.transcript,
		SAS_SEAL_LABEL,
		256,
	);
	return subtle().importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

/** A credential in transit: nonce + ciphertext, both base64url. */
export interface SealedSasPayload {
	readonly iv: string;
	readonly ciphertext: string;
}

/**
 * Seal a credential to the other side's key.
 *
 * E3's step 5, and the part worth noticing: the token never crosses in plaintext and
 * the operator never types or copies it. The node process that RELAYS the sealed
 * payload (`refarm web serve`) is not the process that minted it and does not hold the
 * key — so the credential is not readable at the hop that stores it.
 */
export async function sealSasPayload(
	options: DeriveSasOptions & { plaintext: string },
): Promise<SealedSasPayload> {
	const key = await sealingKey(options);
	const iv = new Uint8Array(12);
	globalThis.crypto.getRandomValues(iv);
	const encoded = new TextEncoder().encode(options.plaintext);
	const sealed = await subtle().encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		key,
		encoded as BufferSource,
	);
	return { iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(sealed)) };
}

/** Open a sealed credential. Throws on a bad tag — AES-GCM authenticates, so a payload
 *  that was tampered with does not decrypt to garbage, it does not decrypt. */
export async function openSasPayload(
	options: DeriveSasOptions & { sealed: SealedSasPayload },
): Promise<string> {
	const key = await sealingKey(options);
	const plaintext = await subtle().decrypt(
		{ name: "AES-GCM", iv: fromBase64Url(options.sealed.iv) as BufferSource },
		key,
		fromBase64Url(options.sealed.ciphertext) as BufferSource,
	);
	return new TextDecoder().decode(plaintext);
}

/** A session id with enough entropy to be unguessable, since knowing one is how a
 *  caller polls it. 128 bits, base64url. */
export function newSasSessionId(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}
