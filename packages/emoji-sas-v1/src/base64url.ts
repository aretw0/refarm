/**
 * base64url, by hand, because this block runs in three places with three different
 * "obvious" answers.
 *
 * Node has `Buffer`, the browser has `atob`/`btoa`, and the zero-dependency kit has
 * whichever the device happened to give it. Reaching for either would make the block
 * runtime-specific — the one property `packages/prompt-contract-v1` established as
 * non-negotiable for anything a phone has to parse with nothing installed. Forty
 * lines of table lookup is the price of the same bytes everywhere.
 *
 * URL-SAFE and UNPADDED: these strings travel in JSON bodies and, eventually, in a
 * URL a phone camera reads off a screen. `+`/`/` survive neither well.
 *
 * PURE.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Reverse table, built once. `-1` marks a character that is not in the alphabet. */
const REVERSE: number[] = (() => {
	const table = new Array<number>(128).fill(-1);
	for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
	return table;
})();

export function toBase64Url(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i]!;
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += ALPHABET[b0 >> 2];
		out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
		if (b1 === undefined) break;
		out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
		if (b2 === undefined) break;
		out += ALPHABET[b2 & 0x3f];
	}
	return out;
}

/**
 * Decode, or throw. TOTAL in the sense that matters: every rejection is an explicit
 * throw, never a silently truncated buffer. A public key that decoded to fewer bytes
 * than it should would produce a *different* transcript on one side only — which is
 * exactly the disagreement the emoji exist to reveal, arriving as a bug instead.
 */
export function fromBase64Url(text: string): Uint8Array {
	const length = text.length;
	if (length % 4 === 1) throw new SyntaxError("base64url: truncated input");
	const bytes = new Uint8Array(Math.floor((length * 3) / 4));
	let written = 0;
	let acc = 0;
	let bits = 0;
	for (let i = 0; i < length; i += 1) {
		const code = text.charCodeAt(i);
		const value = code < 128 ? REVERSE[code]! : -1;
		if (value < 0) throw new SyntaxError("base64url: invalid character");
		acc = (acc << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes[written] = (acc >> bits) & 0xff;
			written += 1;
		}
	}
	return bytes.subarray(0, written);
}

/** UTF-8 bytes of `text`. `TextEncoder` is a web standard present in Node and every
 *  browser this block targets, so it is the one global worth relying on. */
export function utf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/** Constant-time-ish equality over two byte strings. Length is allowed to leak
 *  (it is public); content is not. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}
