import { describe, it, expect } from "vitest";
import { generatePKCE, base64urlEncode } from "./pkce.js";

describe("generatePKCE", () => {
	it("returns verifier and challenge as non-empty strings", async () => {
		const { verifier, challenge } = await generatePKCE();
		expect(typeof verifier).toBe("string");
		expect(verifier.length).toBeGreaterThan(0);
		expect(typeof challenge).toBe("string");
		expect(challenge.length).toBeGreaterThan(0);
	});

	it("verifier and challenge differ", async () => {
		const { verifier, challenge } = await generatePKCE();
		expect(verifier).not.toBe(challenge);
	});

	it("verifier uses only base64url characters", async () => {
		const { verifier } = await generatePKCE();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("challenge uses only base64url characters", async () => {
		const { challenge } = await generatePKCE();
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("generates different values on each call", async () => {
		const a = await generatePKCE();
		const b = await generatePKCE();
		expect(a.verifier).not.toBe(b.verifier);
	});

	it("challenge equals BASE64URL(SHA-256(verifier))", async () => {
		const { verifier, challenge } = await generatePKCE();
		const encoded = new TextEncoder().encode(verifier);
		const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
		const expected = base64urlEncode(new Uint8Array(hashBuffer));
		expect(challenge).toBe(expected);
	});
});
