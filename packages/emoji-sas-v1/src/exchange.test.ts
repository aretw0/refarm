import { describe, expect, it } from "vitest";

import { fromBase64Url, toBase64Url } from "./base64url.js";
import { formatSasRow, SAS_EMOJI_COUNT, SAS_EMOJI_SET_SIZE } from "./emoji.js";
import {
	deriveSasEmoji,
	exportSasPrivateKey,
	generateSasKeyPair,
	importSasPrivateKey,
	newSasSessionId,
	openSasPayload,
	sealSasPayload,
} from "./exchange.js";
import { checkSasTranscript, encodeSasTranscript, SAS_EMOJI_LABEL, SAS_SEAL_LABEL, type SasTranscript } from "./transcript.js";

/** Two ephemeral parties and the transcript that names them. */
async function pair() {
	const initiator = await generateSasKeyPair({ extractable: true });
	const confirmer = await generateSasKeyPair({ extractable: true });
	const transcript: SasTranscript = {
		sessionId: newSasSessionId(),
		initiatorPublicKey: initiator.publicKey,
		confirmerPublicKey: confirmer.publicKey,
	};
	return { initiator, confirmer, transcript };
}

const row = (emoji: Awaited<ReturnType<typeof deriveSasEmoji>>) => emoji.map((e) => e.index).join(",");

describe("S1 — P-256 ECDH through WebCrypto", () => {
	it("both sides derive the SAME seven emoji from Matrix's set", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const theirs = await deriveSasEmoji({
			privateKey: initiator.privateKey,
			peerPublicKey: confirmer.publicKey,
			transcript,
		});
		const ours = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		expect(row(ours)).toBe(row(theirs));
		expect(ours).toHaveLength(SAS_EMOJI_COUNT);
		for (const emoji of ours) {
			expect(emoji.index).toBeGreaterThanOrEqual(0);
			expect(emoji.index).toBeLessThan(SAS_EMOJI_SET_SIZE);
		}
		expect(formatSasRow(ours)).toBe(formatSasRow(theirs));
	});

	it("is deterministic — the same inputs always produce the same row", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const first = await deriveSasEmoji({
			privateKey: initiator.privateKey,
			peerPublicKey: confirmer.publicKey,
			transcript,
		});
		const second = await deriveSasEmoji({
			privateKey: initiator.privateKey,
			peerPublicKey: confirmer.publicKey,
			transcript,
		});
		expect(row(second)).toBe(row(first));
	});

	it("a private key survives an export/import round trip across a process boundary", async () => {
		// The confirming side's key is written to disk so the CLI (a DIFFERENT process
		// from `web serve`) can derive the row itself rather than trusting one computed
		// elsewhere. If the round trip changed the key, the two halves would disagree
		// and every real verification would read as a mismatch.
		const { initiator, confirmer, transcript } = await pair();
		const reimported = await importSasPrivateKey(await exportSasPrivateKey(confirmer.privateKey));
		const direct = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		const viaDisk = await deriveSasEmoji({
			privateKey: reimported,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		expect(row(viaDisk)).toBe(row(direct));
	});
});

describe("S2 — the comparison binds the TRANSCRIPT, not just the secret", () => {
	it("a SWAPPED public key changes the emoji, with the shared secret untouched", async () => {
		// THE TEETH OF S2, asserted directly.
		//
		// Both derivations below use the SAME private key and the SAME peer public key,
		// so the ECDH output is bit-for-bit identical. The only thing that differs is
		// what the transcript SAYS about who is in the exchange. If the row is derived
		// from the secret alone, these two are equal and this test fails — which is
		// exactly the ritual that looks identical and authenticates nothing.
		const { initiator, confirmer, transcript } = await pair();
		const impostor = await generateSasKeyPair({ extractable: true });

		const honest = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		const swapped = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			// Same two parties actually talking; a transcript naming a third.
			transcript: { ...transcript, initiatorPublicKey: initiator.publicKey, confirmerPublicKey: impostor.publicKey },
		});
		expect(row(swapped)).not.toBe(row(honest));
	});

	it("swapping the two ROLES changes the emoji — the encoding is ordered, never sorted", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const straight = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		const rolesSwapped = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript: {
				sessionId: transcript.sessionId,
				initiatorPublicKey: transcript.confirmerPublicKey,
				confirmerPublicKey: transcript.initiatorPublicKey,
			},
		});
		expect(row(rolesSwapped)).not.toBe(row(straight));
	});

	it("a different session id changes the emoji", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const first = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
		});
		const second = await deriveSasEmoji({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript: { ...transcript, sessionId: newSasSessionId() },
		});
		expect(row(second)).not.toBe(row(first));
	});

	it("a party in the middle makes the two rows differ — the whole point", async () => {
		// The attack the SAS exists to defeat, end to end. Alice starts, Mallory
		// terminates her exchange and opens her own with Bob. Both halves are perfectly
		// valid key exchanges; the transcripts are not the same transcript.
		const alice = await generateSasKeyPair({ extractable: true });
		const mallory = await generateSasKeyPair({ extractable: true });
		const bob = await generateSasKeyPair({ extractable: true });
		const sessionId = newSasSessionId();

		const aliceSees = await deriveSasEmoji({
			privateKey: alice.privateKey,
			peerPublicKey: mallory.publicKey,
			transcript: { sessionId, initiatorPublicKey: alice.publicKey, confirmerPublicKey: mallory.publicKey },
		});
		const bobSees = await deriveSasEmoji({
			privateKey: bob.privateKey,
			peerPublicKey: mallory.publicKey,
			transcript: { sessionId, initiatorPublicKey: mallory.publicKey, confirmerPublicKey: bob.publicKey },
		});
		expect(row(bobSees)).not.toBe(row(aliceSees));
	});

	it("refuses to derive over a transcript that does not name the peer", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const stranger = await generateSasKeyPair();
		await expect(
			deriveSasEmoji({
				privateKey: confirmer.privateKey,
				peerPublicKey: initiator.publicKey,
				transcript: {
					sessionId: transcript.sessionId,
					initiatorPublicKey: stranger.publicKey,
					confirmerPublicKey: confirmer.publicKey,
				},
			}),
		).rejects.toThrow(/not in the transcript/);
	});

	it("refuses a reflected exchange (both sides presenting one key)", async () => {
		const { confirmer, transcript } = await pair();
		expect(
			checkSasTranscript({
				...transcript,
				initiatorPublicKey: confirmer.publicKey,
				confirmerPublicKey: confirmer.publicKey,
			}),
		).toMatch(/same public key/);
	});

	it("the encoding is length-prefixed, so no two different transcripts collide", () => {
		// Without length prefixes, ("ab","c") and ("a","bc") encode identically — a
		// value containing the separator would forge a transcript.
		const label = SAS_EMOJI_LABEL;
		const left = encodeSasTranscript(
			{ sessionId: "s", initiatorPublicKey: "ab", confirmerPublicKey: "c" },
			label,
		);
		const right = encodeSasTranscript(
			{ sessionId: "s", initiatorPublicKey: "a", confirmerPublicKey: "bc" },
			label,
		);
		expect(Array.from(left)).not.toEqual(Array.from(right));
	});

	it("the label is INSIDE the encoding — the seal key can never be the shown key", () => {
		const transcript: SasTranscript = {
			sessionId: "s",
			initiatorPublicKey: "a",
			confirmerPublicKey: "b",
		};
		expect(Array.from(encodeSasTranscript(transcript, SAS_EMOJI_LABEL))).not.toEqual(
			Array.from(encodeSasTranscript(transcript, SAS_SEAL_LABEL)),
		);
	});
});

describe("the credential never crosses in plaintext (E3 step 5)", () => {
	it("seals to the other side's key and opens on the other side only", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const sealed = await sealSasPayload({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
			plaintext: "the-token",
		});
		expect(sealed.ciphertext).not.toContain("the-token");
		const opened = await openSasPayload({
			privateKey: initiator.privateKey,
			peerPublicKey: confirmer.publicKey,
			transcript,
			sealed,
		});
		expect(opened).toBe("the-token");
	});

	it("a third party holding the ciphertext cannot open it", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const eavesdropper = await generateSasKeyPair({ extractable: true });
		const sealed = await sealSasPayload({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
			plaintext: "the-token",
		});
		await expect(
			openSasPayload({
				privateKey: eavesdropper.privateKey,
				peerPublicKey: confirmer.publicKey,
				transcript: { ...transcript, initiatorPublicKey: eavesdropper.publicKey },
				sealed,
			}),
		).rejects.toBeTruthy();
	});

	it("a tampered ciphertext does not decrypt to garbage — it does not decrypt", async () => {
		const { initiator, confirmer, transcript } = await pair();
		const sealed = await sealSasPayload({
			privateKey: confirmer.privateKey,
			peerPublicKey: initiator.publicKey,
			transcript,
			plaintext: "the-token",
		});
		// Flip a BIT of the decoded ciphertext, not a base64 character: the final
		// character of an unpadded base64url string carries unused low bits, so
		// "change the last letter" can decode to the very same bytes.
		const bytes = fromBase64Url(sealed.ciphertext);
		bytes[0] = bytes[0]! ^ 0x01;
		const flipped = toBase64Url(bytes);
		await expect(
			openSasPayload({
				privateKey: initiator.privateKey,
				peerPublicKey: confirmer.publicKey,
				transcript,
				sealed: { iv: sealed.iv, ciphertext: flipped },
			}),
		).rejects.toBeTruthy();
	});
});

describe("keys on the wire", () => {
	it("refuses anything that is not a 65-byte uncompressed P-256 point", async () => {
		const { confirmer, transcript } = await pair();
		await expect(
			deriveSasEmoji({
				privateKey: confirmer.privateKey,
				peerPublicKey: transcript.initiatorPublicKey.slice(0, 10),
				transcript,
			}),
		).rejects.toThrow();
	});

	it("session ids are unguessable and distinct", () => {
		const ids = new Set(Array.from({ length: 500 }, () => newSasSessionId()));
		expect(ids.size).toBe(500);
		for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(21);
	});
});
