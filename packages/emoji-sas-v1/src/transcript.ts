/**
 * S2 — THE TRANSCRIPT. The single place this design is silently wrong if it is rushed.
 *
 * The subtle failure is deriving the short string from the shared secret alone. Two
 * parties can share a secret and still disagree about *who they think they are talking
 * to*: a relay that terminates one exchange and opens another ends up holding two
 * secrets, and if the emoji come from a secret rather than from a transcript, each side
 * sees a row derived from the secret it shares with the relay — and both rows are
 * internally consistent. The operator compares two pictures, they match, and the
 * comparison has authenticated nothing. That is worse than no ritual, because it
 * manufactures confidence.
 *
 * So the emoji are derived over the TRANSCRIPT: both public keys and the session id,
 * bound into HKDF's `info`. Under a relay the two sides no longer agree on what the
 * transcript *is* — the browser's transcript names the relay's key where the node's
 * names the browser's — so the rows differ, which is the entire signal.
 *
 * TWO PROPERTIES THIS ENCODING MUST HAVE, and neither is decorative:
 *
 *   1. ROLE-ORDERED, never sorted. `initiator` and `confirmer` occupy fixed positions.
 *      Sorting (or "whichever key is lexically smaller first") would make a swapped
 *      pair encode identically, which is precisely the swap the test suite asserts
 *      changes the row.
 *   2. UNAMBIGUOUS. Every field is length-prefixed, so no concatenation of one set of
 *      values can ever equal the concatenation of a different set. Joining with a
 *      separator instead would let a value containing the separator forge a transcript.
 *
 * PURE — no crypto, no I/O. Callers hand the encoding to HKDF.
 */

import { utf8 } from "./base64url.js";

/** Domain separation. Bump only for a breaking change to the encoding below. */
export const SAS_TRANSCRIPT_DOMAIN = "refarm.emoji-sas.v1/transcript";

/** The label under which the SHORT AUTHENTICATION STRING is derived. */
export const SAS_EMOJI_LABEL = "refarm.emoji-sas.v1/emoji";

/** The label under which the credential-sealing key is derived. A DIFFERENT label over
 *  the same transcript: the emoji are shown on two screens, so anything the emoji key
 *  could unlock would be unlocked by something an operator reads aloud. */
export const SAS_SEAL_LABEL = "refarm.emoji-sas.v1/seal";

/**
 * What both sides must agree on, exactly.
 *
 * All three fields are PUBLIC — two public keys and an identifier. Nothing secret goes
 * into a transcript; the secret is the ECDH output the transcript is mixed with.
 */
export interface SasTranscript {
	/** The exchange's identifier, minted by the confirming side. */
	readonly sessionId: string;
	/** base64url raw (uncompressed P-256) public key of the side that STARTED. */
	readonly initiatorPublicKey: string;
	/** base64url raw (uncompressed P-256) public key of the side that CONFIRMS. */
	readonly confirmerPublicKey: string;
}

function u32(value: number): Uint8Array {
	const out = new Uint8Array(4);
	out[0] = (value >>> 24) & 0xff;
	out[1] = (value >>> 16) & 0xff;
	out[2] = (value >>> 8) & 0xff;
	out[3] = value & 0xff;
	return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/**
 * The canonical bytes of a transcript, under `label`.
 *
 * `domain || label || len(sessionId) || sessionId || len(initiator) || initiator ||
 *  len(confirmer) || confirmer`, every length a big-endian u32.
 *
 * The LABEL is inside the encoding rather than beside it so that a key derived for
 * sealing can never be the key shown as emoji, even if a caller passed the wrong
 * label constant — the bytes differ before HKDF ever sees them.
 */
export function encodeSasTranscript(transcript: SasTranscript, label: string): Uint8Array {
	const fields = [
		transcript.sessionId,
		transcript.initiatorPublicKey,
		transcript.confirmerPublicKey,
	];
	const parts: Uint8Array[] = [utf8(SAS_TRANSCRIPT_DOMAIN), utf8(label)];
	for (const field of fields) {
		const bytes = utf8(field);
		parts.push(u32(bytes.length), bytes);
	}
	return concat(parts);
}

/**
 * Is this transcript usable at all? Returns a reason rather than a boolean, because
 * "the transcript is incomplete" and "the two sides sent the same key" are different
 * refusals and only one of them is an attack shape.
 *
 * An identical pair of public keys is refused outright: a party reflecting our own key
 * back at us produces a valid-looking exchange whose ECDH output it cannot compute but
 * whose *transcript* is symmetric, and refusing here is cheaper than reasoning about
 * what that would mean downstream.
 */
export function checkSasTranscript(transcript: SasTranscript): string | null {
	if (!transcript.sessionId) return "session id is empty";
	if (!transcript.initiatorPublicKey) return "initiator public key is empty";
	if (!transcript.confirmerPublicKey) return "confirmer public key is empty";
	if (transcript.initiatorPublicKey === transcript.confirmerPublicKey) {
		return "the two sides presented the same public key — refusing a reflected exchange";
	}
	return null;
}
