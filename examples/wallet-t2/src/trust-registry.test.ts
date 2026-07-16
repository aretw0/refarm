import { createInMemoryCredentialsProviderFixture, type VerifiableCredential } from "@refarm.dev/credentials-contract-v1";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { buildWalletHost } from "./cli.js";
import { resolveVerifyPolicyFromEnv } from "@refarm.dev/wallet";

/**
 * The trust registry is reachable through the SHIPPED CLI (buildWalletHost), not only the test
 * helper. Regression guard for the half-wired seam: verifyPolicy must thread bundle → host →
 * createWalletCapabilities → verify, so `verify --strict` REJECTS an untrusted issuer in the real
 * product — the anti-fraud claim the README/ADR-079 make.
 */

describe("resolveVerifyPolicyFromEnv — the trust registry from the environment", () => {
	it("parses DGK_TRUSTED_ISSUERS into a trustedIssuers allow-list", () => {
		expect(resolveVerifyPolicyFromEnv({ DGK_TRUSTED_ISSUERS: "did:a, did:b ,did:c" })).toEqual({
			trustedIssuers: ["did:a", "did:b", "did:c"],
		});
	});
	it("returns undefined when unset or empty (no registry → self-trust default)", () => {
		expect(resolveVerifyPolicyFromEnv({})).toBeUndefined();
		expect(resolveVerifyPolicyFromEnv({ DGK_TRUSTED_ISSUERS: "  " })).toBeUndefined();
	});
});

describe("trust registry is wired through buildWalletHost (the shipped CLI path)", () => {
	let fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>;
	let dir: string;
	const now = () => "2026-07-12T00:00:00.000Z";

	beforeEach(() => {
		fixture = createInMemoryCredentialsProviderFixture();
		dir = mkdtempSync(path.join(os.tmpdir(), "dgk-trust-"));
	});

	async function issue(): Promise<VerifiableCredential> {
		const issuer = await fixture.identity.create("Emissor desconhecido");
		const subject = await fixture.identity.create("Cidadão");
		return fixture.provider.issue(
			{
				"@context": ["https://www.w3.org/2018/credentials/v1"],
				type: ["VerifiableCredential", "CarteiraDigital"],
				issuer: issuer.id,
				issuanceDate: "2026-01-01T00:00:00.000Z",
				credentialSubject: { id: subject.id, name: "Fulano" },
			},
			issuer.id,
		);
	}

	it("verify --strict through the CLI host REJECTS a credential from an issuer NOT in the pinned registry", async () => {
		const vc = await issue(); // an unknown issuer
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		// The deployment pins a DIFFERENT civic issuer — exactly what a real CLI config does.
		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
			verifyPolicy: { trustedIssuers: ["did:gov:br:serpro-civic-issuer"] },
		});
		const registry = host.registry();
		const importVerb = registry.get("import");
		const verifyVerb = registry.get("verify");
		if (!importVerb || "actions" in importVerb || !verifyVerb || "actions" in verifyVerb) {
			throw new Error("import/verify not mounted");
		}
		const id = ((await importVerb.run({ args: { file }, options: {}, json: true })) as unknown as { id: string }).id;
		const res = (await verifyVerb.run({ args: { id }, options: { strict: true }, json: true })) as unknown as {
			ok: boolean;
			error?: string;
			failures?: string[];
		};
		// The signature is valid, but the issuer is untrusted → rejected in the SHIPPED path.
		expect(res.ok).toBe(false);
		expect(res.error).toBe("verification_failed");
		expect(res.failures?.join(" ")).toMatch(/not trusted|untrusted/i);
	});
});
