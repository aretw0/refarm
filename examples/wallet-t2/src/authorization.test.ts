import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWalletCapabilities, walletCapabilityBundle } from "./persona.js";

/**
 * The T2 authorization journey (consent → present → revoke) driven through the wallet's
 * verbs, proving the gap the trabalho named is closed: purpose-bound consent, minimal
 * selective disclosure, auditable revocation, and a revoked authorization being unusable.
 */

const now = () => "2026-07-13T00:00:00.000Z";

function walletVerbs() {
	const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), "wallet-authz-")), "state.json");
	const bundle = walletCapabilityBundle({ statePath, now });
	const verbs = createWalletCapabilities(bundle.records, {
		credentialsProvider: bundle.credentialsProvider,
		identity: bundle.identity,
		authorizationProvider: bundle.authorizationProvider,
		now,
	});
	const byName = Object.fromEntries(verbs.map((v) => [v.name, v]));
	return Object.assign(byName, { __records: bundle.records });
}

const request = {
	args: { requester: "servico-beneficio" },
	options: { purpose: "verificar elegibilidade", scope: "faixa_etaria,vinculo", expires: "2099-01-01T00:00:00.000Z" },
	json: true,
} as const;

describe("wallet authorization journey", () => {
	let verbs: ReturnType<typeof walletVerbs>;
	beforeEach(() => {
		verbs = walletVerbs();
	});
	afterEach(() => {});

	it("authorize grants a signed, purpose-bound, scoped receipt", async () => {
		const env = (await verbs.authorize!.run!(request)) as Record<string, unknown>;
		expect(env.ok).toBe(true);
		expect(env.status).toBe("active");
		expect(env.scope).toEqual(["faixa_etaria", "vinculo"]);
		const receipt = env.receipt as { purpose: string; proof: { signature: string } };
		expect(receipt.purpose).toBe("verificar elegibilidade");
		expect(receipt.proof.signature).toBeTruthy();
	});

	it("authorize rejects consent that lacks purpose/scope/expiry", async () => {
		const env = (await verbs.authorize!.run!({
			args: { requester: "x" },
			options: {},
			json: true,
		})) as Record<string, unknown>;
		expect(env.ok).toBe(false);
		expect(env.error).toBe("missing_consent_fields");
	});

	it("present discloses only the authorized attributes", async () => {
		const authz = (await verbs.authorize!.run!(request)) as Record<string, unknown>;
		const env = (await verbs.present!.run!({ args: { id: authz.id as string }, options: {}, json: true })) as Record<string, unknown>;
		expect(env.ok).toBe(true);
		expect((env.disclosed as string[]).sort()).toEqual(["faixa_etaria", "vinculo"]);
		const attrs = (env.presentation as { attributes: Record<string, unknown> }).attributes;
		expect(attrs).not.toHaveProperty("nome_social");
		expect(attrs).not.toHaveProperty("municipio");
	});

	it("revoke records the transition and makes the authorization unusable", async () => {
		const authz = (await verbs.authorize!.run!(request)) as Record<string, unknown>;
		const id = authz.id as string;
		const rev = (await verbs.revoke!.run!({ args: { id }, options: { reason: "withdrew" }, json: true })) as Record<string, unknown>;
		expect(rev.ok).toBe(true);
		expect(rev.statusBefore).toBe("active");
		expect(rev.statusAfter).toBe("revoked");

		// A revoked authorization can no longer present.
		const present = (await verbs.present!.run!({ args: { id }, options: {}, json: true })) as Record<string, unknown>;
		expect(present.ok).toBe(false);
		expect(present.error).toBe("not_usable");
	});

	it("revoke PERSISTS a durable RevocationEvent record (the auditable trail survives the command)", async () => {
		const authz = (await verbs.authorize!.run!(request)) as Record<string, unknown>;
		const id = authz.id as string;
		await verbs.revoke!.run!({ args: { id }, options: { reason: "mudei de ideia" }, json: true });

		// The event is a durable record in the wallet — not just returned in the envelope.
		const records = (verbs as unknown as { __records: { loadManifest: () => { records: Array<Record<string, unknown>> } } })
			.__records.loadManifest().records;
		const eventRecord = records.find((r) => (r["@type"] as string[])?.includes("RevocationEvent"));
		expect(eventRecord).toBeTruthy();
		const fields = eventRecord!.fields as Record<string, unknown>;
		expect(fields.statusBefore).toBe("active");
		expect(fields.statusAfter).toBe("revoked");
		expect(fields.reason).toBe("mudei de ideia");
		expect(fields.revokedAt).toBeTruthy();
	});
});
