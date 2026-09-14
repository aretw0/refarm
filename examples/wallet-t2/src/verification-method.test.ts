import { createInMemoryCredentialsProviderFixture, type VerifiableCredential } from "@refarm.dev/credentials-contract-v1";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { buildWalletHost } from "./cli.js";

/**
 * `CredentialProof.verificationMethod` is a REQUIRED field three real write paths populate
 * (issuer proof, holder proof, status-list fallback — packages/credentials-contract-v1/src/
 * reference.ts) but until now nothing ever READ it back at verify time: `identity.verify()`
 * only confirmed a valid signature exists and that its signer's id matches the issuer, never
 * that the specific KEY the proof CLAIMS (`verificationMethod`) is the key that actually signed.
 * A verifier could swap `verificationMethod` for a different real key and verification would
 * silently pass. This proves the LOCAL self-check closes that gap through the SHIPPED CLI path,
 * for the case this repo's own identity provider can resolve (a foreign/unresolvable DID stays
 * an explicit, dated deferral — see reference.ts's verifyCredential, 2026-08-04).
 */
describe("verificationMethod is checked against the resolved signer's real key (through the shipped CLI)", () => {
	let fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>;
	let dir: string;

	beforeEach(() => {
		fixture = createInMemoryCredentialsProviderFixture();
		dir = mkdtempSync(path.join(os.tmpdir(), "dgk-verification-method-"));
	});

	async function issue(issuerId: string, subjectId: string): Promise<VerifiableCredential> {
		return fixture.provider.issue(
			{
				"@context": ["https://www.w3.org/2018/credentials/v1"],
				type: ["VerifiableCredential", "CarteiraDigital"],
				issuer: issuerId,
				issuanceDate: "2026-01-01T00:00:00.000Z",
				credentialSubject: { id: subjectId, name: "Fulano" },
			},
			issuerId,
		);
	}

	it("verify --strict through the CLI host REJECTS a credential whose verificationMethod was swapped for a different registered identity's key", async () => {
		const issuer = await fixture.identity.create("Emissor confiável");
		// A DIFFERENT, REAL, previously-registered identity — not a made-up string. This is what
		// makes the tamper realistic: the claimed key genuinely exists and genuinely belongs to
		// someone, just not to the signer who actually produced this signature.
		const impostor = await fixture.identity.create("Identidade registrada diferente");
		const subject = await fixture.identity.create("Cidadão");
		const vc = await issue(issuer.id, subject.id);
		expect(vc.proof?.verificationMethod).toBe(issuer.publicKey); // sanity: producer set it honestly

		const tampered: VerifiableCredential = {
			...vc,
			// The signature itself is untouched (still a genuinely valid signature over this exact
			// payload) — only the CLAIM of which key produced it changes.
			proof: { ...vc.proof!, verificationMethod: impostor.publicKey },
		};
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(tampered));
		const statePath = path.join(dir, "wallet.json");

		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
			verifyPolicy: { trustedIssuers: [issuer.id] },
		});
		const registry = host.registry();
		const importVerb = registry.get("import");
		const verifyVerb = registry.get("verify");
		if (!importVerb || "actions" in importVerb || !verifyVerb || "actions" in verifyVerb) {
			throw new Error("import/verify not mounted");
		}
		const id = ((await importVerb.run({ args: { file }, options: {}, json: true })) as unknown as {
			id: string;
		}).id;
		const res = (await verifyVerb.run({
			args: { id },
			options: { strict: true },
			json: true,
		})) as unknown as { ok: boolean; error?: string; failures?: string[] };

		// Today, before this entry, this would silently PASS (nothing read verificationMethod).
		expect(res.ok).toBe(false);
		expect(res.error).toBe("verification_failed");
		expect(res.failures?.join(" ")).toMatch(/verificationMethod/i);
	});

	it("verify --strict through the CLI host ACCEPTS the same credential untampered (no false positive)", async () => {
		const issuer = await fixture.identity.create("Emissor confiável");
		const subject = await fixture.identity.create("Cidadão");
		const vc = await issue(issuer.id, subject.id);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
			verifyPolicy: { trustedIssuers: [issuer.id] },
		});
		const registry = host.registry();
		const importVerb = registry.get("import");
		const verifyVerb = registry.get("verify");
		if (!importVerb || "actions" in importVerb || !verifyVerb || "actions" in verifyVerb) {
			throw new Error("import/verify not mounted");
		}
		const id = ((await importVerb.run({ args: { file }, options: {}, json: true })) as unknown as {
			id: string;
		}).id;
		const res = (await verifyVerb.run({
			args: { id },
			options: { strict: true },
			json: true,
		})) as unknown as { ok: boolean };
		expect(res.ok).toBe(true);
	});

	it("verify-presentation through the CLI host REJECTS a presentation whose verificationMethod was swapped (the symmetric check)", async () => {
		const issuer = await fixture.identity.create("Emissor confiável");
		const impostor = await fixture.identity.create("Identidade registrada diferente");
		const subject = await fixture.identity.create("Cidadão");
		const vc = await issue(issuer.id, subject.id);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
			verifyPolicy: { trustedIssuers: [issuer.id] },
		});
		const registry = host.registry();
		const importVerb = registry.get("import");
		const shareVerb = registry.get("share");
		const verifyPresentationVerb = registry.get("verify-presentation");
		if (
			!importVerb ||
			"actions" in importVerb ||
			!shareVerb ||
			"actions" in shareVerb ||
			!verifyPresentationVerb ||
			"actions" in verifyPresentationVerb
		) {
			throw new Error("import/share/verify-presentation not mounted");
		}
		const id = ((await importVerb.run({ args: { file }, options: {}, json: true })) as unknown as {
			id: string;
		}).id;
		const shared = (await shareVerb.run({
			args: { ids: id },
			options: {},
			json: true,
		})) as unknown as { presentation: { proof: { verificationMethod: string } } };

		// Tamper the PRESENTATION's own proof.verificationMethod (the holder's, not the credential's)
		// for a different, real, previously-registered identity's public key.
		const tamperedPresentation = {
			...shared.presentation,
			proof: { ...shared.presentation.proof, verificationMethod: impostor.publicKey },
		};
		const presentationFile = path.join(dir, "presentation.json");
		writeFileSync(presentationFile, JSON.stringify(tamperedPresentation));

		const res = (await verifyPresentationVerb.run({
			args: { file: presentationFile },
			options: { strict: true },
			json: true,
		})) as unknown as { ok: boolean; error?: string; failures?: string[] };

		expect(res.ok).toBe(false);
		expect(res.error).toBe("presentation_rejected");
		expect(res.failures?.join(" ")).toMatch(/verificationMethod/i);
	});
});
