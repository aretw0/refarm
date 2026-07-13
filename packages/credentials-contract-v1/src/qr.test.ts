import { describe, expect, it } from "vitest";

import { decodeCredentialQrPayload, scanCredentialQr } from "./qr.js";

const VC = {
	"@context": ["https://www.w3.org/ns/credentials/v2"],
	type: ["VerifiableCredential"],
	issuer: "did:example:issuer",
	credentialSubject: { id: "did:example:citizen", nome: "Cidadão Exemplo" },
};
const VC_JSON = JSON.stringify(VC);
const base64url = (s: string): string =>
	Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("decodeCredentialQrPayload", () => {
	it("decodes raw VC JSON", () => {
		const r = decodeCredentialQrPayload(VC_JSON);
		expect(r.ok).toBe(true);
		expect(r.credential?.issuer).toBe("did:example:issuer");
	});

	it("decodes base64url-encoded VC JSON (the compact QR encoding)", () => {
		const r = decodeCredentialQrPayload(base64url(VC_JSON));
		expect(r.ok).toBe(true);
		expect(r.credential?.credentialSubject).toMatchObject({ nome: "Cidadão Exemplo" });
	});

	it("decodes a credential-offer URL with a raw JSON credential param", () => {
		const url = `https://wallet.example/offer?credential=${encodeURIComponent(VC_JSON)}`;
		expect(decodeCredentialQrPayload(url).ok).toBe(true);
	});

	it("decodes a credential-offer URL with a base64url credential param", () => {
		const url = `https://wallet.example/offer?credential_offer=${base64url(VC_JSON)}`;
		const r = decodeCredentialQrPayload(url);
		expect(r.ok).toBe(true);
		expect(r.credential?.issuer).toBe("did:example:issuer");
	});

	it("rejects an empty payload", () => {
		expect(decodeCredentialQrPayload("   ")).toEqual({ ok: false, error: "empty" });
	});

	it("rejects base64url that decodes to non-credential JSON", () => {
		const r = decodeCredentialQrPayload(base64url(JSON.stringify({ hello: "world" })));
		expect(r.ok).toBe(false);
		expect(r.error).toBe("not-a-credential");
	});

	it("rejects an unsupported payload (not JSON, not base64url, not a URL)", () => {
		const r = decodeCredentialQrPayload("!!! not a credential !!!");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("unsupported-encoding");
	});

	it("returns the canonical JSON text for a decoded credential (for hashing/storing)", () => {
		const r = decodeCredentialQrPayload(base64url(VC_JSON));
		expect(r.json && JSON.parse(r.json).issuer).toBe("did:example:issuer");
	});
});

describe("scanCredentialQr — image → text → credential via the injected decoder", () => {
	it("composes an injected image decoder with the payload decode", async () => {
		const image = new Uint8Array([0, 1, 2]);
		const r = await scanCredentialQr(image, () => VC_JSON); // fake scanner returns the VC text
		expect(r.ok).toBe(true);
		expect(r.credential?.issuer).toBe("did:example:issuer");
	});

	it("reports empty when the scanner finds no QR", async () => {
		const r = await scanCredentialQr(new Uint8Array([0]), () => null);
		expect(r).toEqual({ ok: false, error: "empty" });
	});
});
