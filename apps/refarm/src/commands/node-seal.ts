/**
 * THE SEAL — the only cryptography in this repository, and deliberately the smallest possible.
 *
 * WHY `node:crypto` AND NOTHING ELSE. Measured 2026-08-13: there is no encryption primitive
 * anywhere in this repo. `heartwood` signs and verifies; `vault-contract-v1` is a knowledge vault.
 * Sealing with the standard library costs zero dependencies; `age` costs a binary on every machine
 * that must restore, which is the one machine you cannot make assumptions about.
 *
 * CUSTODY IS CLEARTEXT, AND THAT IS THE POINT. `custody`, `kdf` and `cipher` sit outside the
 * ciphertext so a build that cannot open a file can still SAY WHY. The operator chose the passphrase
 * as the floor and asked, in as many words, that better custodies be able to arrive later; a format
 * that could not explain an unrecognised one would strand him at exactly that moment.
 *
 * Named successors, so the seam is documented rather than implied:
 *   `derive-from-session`  — `packages/wallet/src/recovery.ts`, once `silo/key-manager.js`'s
 *                            `deriveChildKey` stops being a stub.
 *   `peer`                 — emoji-SAS over a device that still trusts this node.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export const SEAL_CIPHER = "aes-256-gcm";

/**
 * `maxmem` IS NOT OPTIONAL. These parameters need `128 * N * r` = 128 MiB; Node's default cap is
 * 32 MiB and `scryptSync` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` without this. Measured
 * 2026-08-13: 291 ms per derivation, paid once per declare and once per apply.
 */
export const SCRYPT_PARAMS = { name: "scrypt", N: 131072, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_BYTES = 32;

/** Custodies THIS build can open. A value outside this list is a newer refarm's, not an error. */
export const KNOWN_CUSTODIES = ["passphrase"] as const;

export interface SealEnvelope {
	readonly custody: string;
	readonly kdf: { readonly name: string; readonly N: number; readonly r: number; readonly p: number };
	readonly cipher: string;
	readonly salt: string;
	readonly iv: string;
	readonly tag: string;
	readonly payload: string;
}

/** THREE STATES. "I cannot open this" and "this is not a seal" are different sentences. */
export type SealState =
	| { readonly state: "openable"; readonly custody: string }
	| { readonly state: "unknown-custody"; readonly custody: string; readonly reason: string }
	| { readonly state: "unreadable"; readonly reason: string };

/** A refusal the command layer can render as a sentence instead of a stack trace. */
export class SealRefusalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SealRefusalError";
	}
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
	return scryptSync(passphrase, salt, KEY_BYTES, { ...SCRYPT_PARAMS, maxmem: SCRYPT_MAXMEM });
}

/** PURE apart from randomness. Seals a payload under a passphrase. */
export function sealPayload(payload: unknown, passphrase: string): SealEnvelope {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv(SEAL_CIPHER, deriveKey(passphrase, salt), iv);
	const sealed = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
		cipher.final(),
	]);
	return {
		custody: "passphrase",
		kdf: SCRYPT_PARAMS,
		cipher: SEAL_CIPHER,
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		payload: sealed.toString("base64"),
	};
}

/** PURE. Opens a passphrase seal, or refuses by name. */
export function unsealPayload(envelope: SealEnvelope, passphrase: string): unknown {
	try {
		const decipher = createDecipheriv(
			SEAL_CIPHER,
			deriveKey(passphrase, Buffer.from(envelope.salt, "base64")),
			Buffer.from(envelope.iv, "base64"),
		);
		decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
		const opened = Buffer.concat([
			decipher.update(Buffer.from(envelope.payload, "base64")),
			decipher.final(),
		]);
		return JSON.parse(opened.toString("utf8"));
	} catch {
		// GCM cannot tell a wrong key from altered bytes, so this says both and leads with the one
		// that is nearly always true. The try covers `createDecipheriv` too: a truncated iv or tag
		// throws there, and an operator holding a damaged file is owed the same sentence.
		throw new SealRefusalError(
			"the seal did not open: the passphrase is wrong, or the file has been altered since it was sealed",
		);
	}
}

/** PURE. What a seal is, WITHOUT opening it. */
export function readSealState(envelope: unknown): SealState {
	const seal = envelope as Partial<SealEnvelope> | null | undefined;
	if (!seal || typeof seal !== "object" || typeof seal.custody !== "string") {
		return { state: "unreadable", reason: "not a seal: no custody is declared" };
	}
	if (!(KNOWN_CUSTODIES as readonly string[]).includes(seal.custody)) {
		return {
			state: "unknown-custody",
			custody: seal.custody,
			reason: `sealed by custody "${seal.custody}", which this build does not implement — use a refarm that does`,
		};
	}
	if (typeof seal.payload !== "string" || typeof seal.salt !== "string" || typeof seal.iv !== "string") {
		return { state: "unreadable", reason: "a passphrase seal is missing its salt, iv or payload" };
	}
	return { state: "openable", custody: seal.custody };
}
