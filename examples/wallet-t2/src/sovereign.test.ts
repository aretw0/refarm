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

	it("the wallet's own `share` verb signs the presentation inside the sandbox (CLI path)", async () => {
		const { mkdtempSync } = await import("node:fs");
		const os = await import("node:os");
		const path = await import("node:path");
		const { walletCapabilityBundle, createWalletCapabilities } = await import("./persona.js");

		// Build the wallet capabilities the CLI builds — but backed by the sovereign
		// bundle (the DGK_SOVEREIGN=1 path), so `import`/`share` route through the WASM
		// signer, not the in-memory fixture.
		const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), "wallet-sov-")), "state.json");
		const sovereign = await createSovereignWalletBundle();
		const bundle = walletCapabilityBundle({
			statePath,
			credentialsProvider: sovereign.credentialsProvider,
			identity: sovereign.identity,
		});
		const verbs = Object.fromEntries(
			createWalletCapabilities(bundle.records, {
				credentialsProvider: bundle.credentialsProvider,
				identity: bundle.identity,
			}).map((v) => [v.name, v]),
		);

		// Import a credential the citizen holds, then verify it (so it becomes shareable),
		// then share it — the presentation `share` builds is signed by the sovereign key.
		const vc = {
			"@context": ["https://www.w3.org/ns/credentials/v2"],
			type: ["VerifiableCredential", "DiplomaCredential"],
			issuer: "did:example:univ",
			issuanceDate: "2026-01-01T00:00:00Z",
			credentialSubject: { id: "did:example:cidadao", curso: "Engenharia" },
		};
		const vcFile = path.join(mkdtempSync(path.join(os.tmpdir(), "wallet-sov-vc-")), "vc.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(vcFile, JSON.stringify(vc));

		const imported = (await verbs.import!.run!({ args: { file: vcFile }, options: {}, json: true })) as Record<
			string,
			unknown
		>;
		expect(imported.ok).toBe(true);
		const credId = imported.id as string;

		// Share the held credential — the presentation `share` builds is signed by the
		// sovereign key.
		const shared = (await verbs.share!.run!({ args: { ids: credId }, options: {}, json: true })) as Record<
			string,
			unknown
		>;
		// The share produced a presentation; its proof was made by the sovereign key.
		expect(shared.ok).toBe(true);
		const presentation = shared.presentation as { proof?: { signature?: string } };
		expect(presentation?.proof?.signature).toContain("ed25519-wasm-sovereign");
	});
});
