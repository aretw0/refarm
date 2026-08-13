import { describe, expect, it } from "vitest";

import { readSealState, sealPayload, SealRefusalError, unsealPayload } from "./node-seal.js";

const PAYLOAD = { files: { ".refarm/tls/ca.key": "QSBLRVk=" } };

describe("sealPayload / unsealPayload", () => {
	it("round-trips a payload through the passphrase", () => {
		const sealed = sealPayload(PAYLOAD, "correct horse battery staple");
		expect(unsealPayload(sealed, "correct horse battery staple")).toEqual(PAYLOAD);
	});

	it("puts NO plaintext of the payload in the envelope", () => {
		// The whole promise of the format, asserted against the serialised envelope rather than
		// against field names: a key that moves or nests must not leak the bytes.
		const serialised = JSON.stringify(sealPayload(PAYLOAD, "pw"));
		expect(serialised).not.toContain("QSBLRVk=");
		expect(serialised).not.toContain("ca.key");
	});

	it("keeps custody, kdf and cipher in CLEARTEXT so an old file can explain itself", () => {
		const sealed = sealPayload(PAYLOAD, "pw");
		expect(sealed.custody).toBe("passphrase");
		expect(sealed.cipher).toBe("aes-256-gcm");
		expect(sealed.kdf).toEqual({ name: "scrypt", N: 131072, r: 8, p: 1 });
	});

	it("uses a fresh salt and iv per seal, so two seals of one payload differ", () => {
		const a = sealPayload(PAYLOAD, "pw");
		const b = sealPayload(PAYLOAD, "pw");
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.payload).not.toBe(b.payload);
	});

	it("refuses a wrong passphrase by NAME, never by stack trace", () => {
		// A GCM tag failure surfaces as "unable to authenticate data", which reads like corruption.
		// The operator's actual situation is almost always a typo, and the message must say so.
		const sealed = sealPayload(PAYLOAD, "pw");
		expect(() => unsealPayload(sealed, "wrong")).toThrow(SealRefusalError);
		expect(() => unsealPayload(sealed, "wrong")).toThrow(/passphrase/iu);
	});

	it("detects a tampered payload rather than returning altered data", () => {
		const sealed = sealPayload(PAYLOAD, "pw");
		const tampered = { ...sealed, payload: Buffer.from("not the payload").toString("base64") };
		expect(() => unsealPayload(tampered, "pw")).toThrow(SealRefusalError);
	});
});

describe("readSealState", () => {
	it("says a passphrase seal is openable by this build", () => {
		expect(readSealState(sealPayload(PAYLOAD, "pw"))).toMatchObject({
			state: "openable",
			custody: "passphrase",
		});
	});

	it("names an UNKNOWN custody as an answer, not as damage", () => {
		// The format's promise to its own future. A refarm that meets `custody: "peer"` must say what
		// it cannot do; reporting it as unreadable would send the operator hunting for corruption in
		// a file that is perfectly intact.
		const future = { ...sealPayload(PAYLOAD, "pw"), custody: "peer" };
		const state = readSealState(future);
		expect(state).toMatchObject({ state: "unknown-custody", custody: "peer" });
		expect((state as { reason: string }).reason).toMatch(/does not implement/iu);
	});

	it("separates UNREADABLE from both of the above", () => {
		for (const bad of [null, undefined, 42, {}, { custody: 7 }]) {
			expect(readSealState(bad), JSON.stringify(bad)).toMatchObject({ state: "unreadable" });
		}
	});
});
