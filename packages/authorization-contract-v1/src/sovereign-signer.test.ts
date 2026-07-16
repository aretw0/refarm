import { describe, expect, it } from "vitest";

import { createReferenceAuthorizationProvider } from "./reference.js";
import { createSovereignAuthorizationSigner, type IdentitySignerLike } from "./sovereign-signer.js";
import type { ServiceRequest } from "./types.js";

/**
 * A stand-in for a sovereign WASM identity: it "signs" by binding the holder id + a deterministic
 * digest of the data (tamper-sensitive), and verifies by recomputing. It stands in for the real
 * Ed25519-in-WASM provider so the ADAPTER can be tested without loading a component — the wallet's
 * own test exercises the true WASM path.
 */
function fakeSovereignIdentity(): IdentitySignerLike & { algorithm: string } {
	const algorithm = "ed25519-wasm-sovereign";
	const digest = (data: string): string => {
		let h = 0x811c9dc5;
		for (let i = 0; i < data.length; i++) {
			h ^= data.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		return h.toString(16).padStart(8, "0");
	};
	return {
		algorithm,
		sign: async (identityId, data) => ({
			signature: `${algorithm}:${encodeURIComponent(identityId)}:${digest(data)}`,
			algorithm,
		}),
		verify: async (signature, data) => {
			const [, , sig] = signature.split(":");
			return { valid: sig === digest(data) };
		},
	};
}

const request: ServiceRequest = {
	id: "req-1",
	requester: "gov:service-x",
	subject: "cidadao",
	purpose: "prove eligibility",
	requestedAttributes: ["faixa_etaria"],
	expiresAt: "2999-01-01T00:00:00.000Z",
};

describe("createSovereignAuthorizationSigner", () => {
	it("signs the consent journey through the identity and verifies its own receipt", async () => {
		const identity = fakeSovereignIdentity();
		const signer = createSovereignAuthorizationSigner(identity, "did:holder:1", identity.algorithm);
		const provider = createReferenceAuthorizationProvider({ signer, holderId: "did:holder:1" });

		const receipt = await provider.authorize(request);
		// The proof carries the sovereign suite label + a signature the identity produced.
		expect(receipt.proof.algorithm).toBe("ed25519-wasm-sovereign");
		expect(receipt.proof.signature.startsWith("ed25519-wasm-sovereign:")).toBe(true);

		const verification = await provider.verify(receipt);
		expect(verification.valid).toBe(true);
		expect(verification.checks.signature?.ok).toBe(true);
	});

	it("rejects a tampered receipt — the signature no longer covers the payload", async () => {
		const identity = fakeSovereignIdentity();
		const signer = createSovereignAuthorizationSigner(identity, "did:holder:1", identity.algorithm);
		const provider = createReferenceAuthorizationProvider({ signer, holderId: "did:holder:1" });

		const receipt = await provider.authorize(request);
		const tampered = { ...receipt, requester: "attacker:evil" };
		const verification = await provider.verify(tampered);
		expect(verification.valid).toBe(false);
		expect(verification.checks.signature?.ok).toBe(false);
	});
});
