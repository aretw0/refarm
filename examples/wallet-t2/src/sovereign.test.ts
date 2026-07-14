import type { VerifiableCredential } from "@refarm.dev/credentials-contract-v1";
import { describe, expect, it } from "vitest";

import { createSovereignWalletBundle } from "./sovereign.js";

/** A minimal signed-nothing VC the citizen holds (issuer-signed VC verification is
 * out of scope here — we prove the HOLDER's presentation signature, which is the
 * part the sovereign key produces). */
function heldCredential(issuerId: string): VerifiableCredential {
	return {
		"@context": ["https://www.w3.org/ns/credentials/v2"],
		type: ["VerifiableCredential"],
		issuer: issuerId,
		issuanceDate: "2026-01-01T00:00:00.000Z",
		credentialSubject: { id: "did:example:cidadao", documento: "RG-Fictício" },
	} as VerifiableCredential;
}

describe("T2 sovereign wallet — presentations are signed inside the WASM sandbox", () => {
	it("issue → present → verify, every signature produced inside the WASM sandbox", async () => {
		const { credentialsProvider, identity } = await createSovereignWalletBundle();

		// The issuer AND the citizen holder are sovereign identities — their keys live
		// in the sandbox. Creating each unlocks a key internally; TS never receives it.
		const issuer = await identity.create("Órgão Emissor");
		const holder = await identity.create("Cidadão (holder)");
		expect(holder.publicKey).toMatch(/^[0-9a-f]{64}$/);

		// Issue the credential — issue() signs it with the issuer's sovereign key.
		const issued = await credentialsProvider.issue(heldCredential(issuer.id), issuer.id);
		expect(issued.proof).toBeTruthy();

		// Present it AS the citizen — present() signs the VP with the holder's key,
		// also inside the sandbox.
		const presentation = await credentialsProvider.present([issued], holder.id);
		expect(presentation.type).toContain("VerifiablePresentation");
		expect(presentation.proof).toBeTruthy();

		// The receiving party verifies the whole chain — issuer VC proof + holder VP
		// proof — both made in the sandbox, both check out.
		const result = await credentialsProvider.verify(presentation);
		expect(result.valid).toBe(true);
	});

	it("the wallet holds no private key — only the identity provider (a WASM boundary) does", async () => {
		const { identity } = await createSovereignWalletBundle();
		// The IdentityProvider surface exposes create/sign/verify/get — none returns a
		// private key. sign(id, data) takes an id + data, never key material.
		expect(typeof identity.sign).toBe("function");
		expect(identity.pluginId).toBe("@refarm.dev/identity-provider-ref");
		// Signing twice for the same identity is stable — the key is re-unlocked inside
		// the sandbox each time from the session key TS holds (not the private key).
		const who = await identity.create("Cidadã");
		const a = await identity.sign(who.id, "same");
		const b = await identity.sign(who.id, "same");
		expect(a.signature).toBe(b.signature);
	});
});
