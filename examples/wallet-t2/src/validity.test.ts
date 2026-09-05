import { createInMemoryCredentialsProviderFixture, type VerifiableCredential } from "@refarm.dev/credentials-contract-v1";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { buildWalletHost } from "./cli.js";

/**
 * `withinValidity` (packages/credentials-contract-v1/src/reference.ts) is DEFAULT-ON in the
 * wallet's own verify policy (DEFAULT_WALLET_VERIFY_POLICY, packages/wallet/src/credentials.ts),
 * which means the wallet is ALREADY running a validity check against every credential it
 * verifies. Before this, that check vacuously passed forever because nothing in this repo ever
 * set `validFrom`/`validUntil` — not even `issue()`, the one real producer. `issue()` now
 * defaults `validFrom` to the credential's own `issuanceDate`. This proves the OTHER half of the
 * default-on check: a credential whose `validUntil` has already passed is rejected by the
 * wallet's own default policy through the SHIPPED CLI path, not just by direct provider calls.
 */
describe("validity window is enforced by the wallet's already-default policy (through the shipped CLI)", () => {
	let fixture: ReturnType<typeof createInMemoryCredentialsProviderFixture>;
	let dir: string;

	beforeEach(() => {
		fixture = createInMemoryCredentialsProviderFixture();
		dir = mkdtempSync(path.join(os.tmpdir(), "dgk-validity-"));
	});

	async function issueWithValidUntil(validUntil: string): Promise<VerifiableCredential> {
		const issuer = await fixture.identity.create("Emissor confiável");
		const subject = await fixture.identity.create("Cidadão");
		return fixture.provider.issue(
			{
				"@context": ["https://www.w3.org/2018/credentials/v1"],
				type: ["VerifiableCredential", "CarteiraDigital"],
				issuer: issuer.id,
				issuanceDate: "2026-01-01T00:00:00.000Z",
				credentialSubject: { id: subject.id, name: "Fulano" },
				validUntil,
			},
			issuer.id,
		);
	}

	it("verify through the CLI host REJECTS a credential whose validUntil has already passed", async () => {
		const vc = await issueWithValidUntil("2020-01-01T00:00:00.000Z"); // long past
		// issue() must have stamped a real validFrom — the producer half of this entry.
		expect(vc.validFrom).toBe("2026-01-01T00:00:00.000Z");

		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
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
		// No --strict needed: validity is required by the DEFAULT policy already.
		const res = (await verifyVerb.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error?: string;
			failures?: string[];
		};
		expect(res.ok).toBe(false);
		expect(res.error).toBe("verification_failed");
		expect(res.failures?.join(" ")).toMatch(/expired/i);
	});

	it("verify through the CLI host ACCEPTS a credential with no validity window set (unchanged default)", async () => {
		const issuer = await fixture.identity.create("Emissor confiável");
		const subject = await fixture.identity.create("Cidadão");
		const vc = await fixture.provider.issue(
			{
				"@context": ["https://www.w3.org/2018/credentials/v1"],
				type: ["VerifiableCredential", "CarteiraDigital"],
				issuer: issuer.id,
				issuanceDate: "2026-01-01T00:00:00.000Z",
				credentialSubject: { id: subject.id, name: "Fulano" },
			},
			issuer.id,
		);
		const file = path.join(dir, "cred.json");
		writeFileSync(file, JSON.stringify(vc));
		const statePath = path.join(dir, "wallet.json");

		const host = buildWalletHost({
			statePath,
			credentialsProvider: fixture.provider,
			identity: fixture.identity,
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
		const res = (await verifyVerb.run({ args: { id }, options: {}, json: true })) as unknown as {
			ok: boolean;
		};
		expect(res.ok).toBe(true);
	});
});
