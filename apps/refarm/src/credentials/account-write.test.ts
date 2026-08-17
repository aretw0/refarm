import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAccountView } from "@refarm.dev/model-account-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { readCatalog } from "./account-view-loader.js";
import { writeModelCredential, type AccountWriteSilo } from "./account-write.js";

const homes: string[] = [];

function home(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-acct-"));
	homes.push(dir);
	return dir;
}

function fakeSilo(tokens: Record<string, unknown> = {}): AccountWriteSilo & {
	secrets: Map<string, string>;
	tokens: Record<string, unknown>;
} {
	const secrets = new Map<string, string>();
	const state = { ...tokens };
	return {
		secrets,
		tokens: state,
		loadTokens: async () => state,
		saveTokens: async (patch) => Object.assign(state, patch),
		saveSecret: async (ns, id, value) => secrets.set(`${ns}/${id}`, value),
	};
}

afterEach(() => {
	for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const CREDS = { access: "TOKEN-A", refresh: "R", expires: 1, accountId: "pessoal" };

describe("writeModelCredential", () => {
	it("writes the secret namespaced and the descriptor to the catalog", async () => {
		const dir = home();
		const silo = fakeSilo();
		const { descriptor } = await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: CREDS,
		});
		expect(silo.secrets.get(`model/${descriptor!.credentialId}`)).toContain("TOKEN-A");
		expect(readCatalog(dir).map((e) => e.credentialId)).toEqual([descriptor!.credentialId]);
	});

	it("does NOT write the flat slot, so a secret never has two copies", async () => {
		const silo = fakeSilo();
		await writeModelCredential({
			home: home(),
			silo,
			provider: "github-copilot",
			credentials: CREDS,
		});
		expect(JSON.stringify(silo.tokens)).not.toContain("TOKEN-A");
	});

	it("MIGRATES: a re-login retires the provider's legacy entry in the same act", async () => {
		// Without this, a re-login would leave the old flat entry AND add a namespaced one — two
		// accounts for one provider, and every dispatch refusing as ambiguous on a node with one
		// real credential.
		//
		// THE FIXTURE NOW CARRIES AN accountId, and that is the point rather than a detail. The
		// retirement is only safe when the code can SEE that this is a re-login; ISS-128 measured
		// what happens when it retires without looking. The guarantee is unchanged and its
		// precondition is now stated. The operator's own legacy openai-codex blob carries a
		// 36-character accountId, so this is his real shape; the anonymous shape has its own test
		// below, where the deliberate answer is to KEEP.
		const silo = fakeSilo({
			oauthCredentials: {
				"openai-codex": { access: "OLD", accountId: "a" },
				"kimi-api": { access: "KEEP" },
			},
		});
		const result = await writeModelCredential({
			home: home(),
			silo,
			provider: "openai-codex",
			credentials: { access: "NEW", accountId: "a" },
		});
		expect(result.migratedFromLegacy).toBe(true);
		expect(silo.tokens.oauthCredentials).toEqual({ "kimi-api": { access: "KEEP" } });
	});

	it("leaves other providers' legacy entries alone", async () => {
		const silo = fakeSilo({ oauthCredentials: { "kimi-api": { access: "KEEP" } } });
		const result = await writeModelCredential({
			home: home(),
			silo,
			provider: "github-copilot",
			credentials: CREDS,
		});
		expect(result.migratedFromLegacy).toBe(false);
		expect(silo.tokens.oauthCredentials).toEqual({ "kimi-api": { access: "KEEP" } });
	});

	it("keeps TWO accounts of one provider, which is the whole point", async () => {
		const dir = home();
		const silo = fakeSilo();
		await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: { access: "P", accountId: "pessoal" },
		});
		await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: { access: "C", accountId: "corporativa" },
		});
		const catalog = readCatalog(dir);
		expect(catalog).toHaveLength(2);
		expect(catalog.map((e) => e.alias).sort()).toEqual(["account-2", "default"]);
		expect(silo.secrets.size).toBe(2);
	});

	it("a re-login of the SAME account replaces its entry rather than adding one", async () => {
		const dir = home();
		const silo = fakeSilo();
		const first = await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: { access: "OLD", accountId: "pessoal" },
		});
		const again = await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: { access: "FRESH", accountId: "pessoal" },
		});
		expect(again.descriptor!.credentialId).toBe(first.descriptor!.credentialId);
		expect(readCatalog(dir)).toHaveLength(1);
		expect(silo.secrets.get(`model/${again.descriptor!.credentialId}`)).toContain("FRESH");
	});

	it("REFUSES when the store cannot hold namespaced secrets, instead of falling back", async () => {
		// A fallback would write to the store this design is moving away from, and the operator would
		// never learn that the account he just added cannot coexist with another.
		const silo = fakeSilo();
		delete (silo as { saveSecret?: unknown }).saveSecret;
		const result = await writeModelCredential({
			home: home(),
			silo,
			provider: "github-copilot",
			credentials: CREDS,
		});
		expect(result.refusal).toMatch(/cannot hold namespaced secrets/u);
		expect(silo.tokens.oauthCredentials).toBeUndefined();
	});

	it("the written pair is readable back through the view", async () => {
		// End to end: what the writer stored is what the readers will find.
		const dir = home();
		const silo = fakeSilo();
		const { descriptor } = await writeModelCredential({
			home: dir,
			silo,
			provider: "github-copilot",
			credentials: CREDS,
		});
		const view = buildAccountView({
			tokens: {},
			catalog: readCatalog(dir),
			secrets: new Map([[descriptor!.secretRef, JSON.parse(silo.secrets.get(descriptor!.secretRef)!)]]),
		});
		expect(view.credentialFor("github-copilot")).toMatchObject({ kind: "found" });
		expect(view.legacyAccounts).toEqual([]);
	});
});

describe("retiring the legacy entry (ISS-128)", () => {
	// MEASURED 2026-08-16 in a redirected-SILO_HOME lab against this very function: a legacy
	// openai-codex holding account A, a login for account B with a DIFFERENT accountId, and A was
	// gone — deleted by a retirement keyed on the PROVIDER, which returned `migratedFromLegacy:
	// true` and so reported the deletion as a successful migration.
	//
	// sow.ts:390 records an interim refusal being removed on the grounds that "the write no longer
	// can" destroy a stored credential. It could not from a namespaced account. It still could
	// from a legacy one, which is where the operator's own default provider lives.

	it("retires the legacy entry when the login is the SAME account", () => {
		const dir = home();
		const silo = fakeSilo({
			oauthCredentials: { "openai-codex": { access: "TOKEN-A", accountId: "conta-a" } },
		});

		return writeModelCredential({
			home: dir,
			silo,
			provider: "openai-codex",
			credentials: { access: "TOKEN-A-RENOVADO", accountId: "conta-a" },
		}).then((result) => {
			expect(result.migratedFromLegacy).toBe(true);
			expect(silo.tokens.oauthCredentials).toEqual({});
		});
	});

	it("KEEPS the legacy entry when the login is a DIFFERENT account", async () => {
		const dir = home();
		const silo = fakeSilo({
			oauthCredentials: { "openai-codex": { access: "TOKEN-A", accountId: "conta-a" } },
		});

		const result = await writeModelCredential({
			home: dir,
			silo,
			provider: "openai-codex",
			credentials: { access: "TOKEN-B", accountId: "conta-b" },
			alias: "segunda",
		});

		// The second account is stored...
		expect(result.descriptor?.alias).toBe("segunda");
		expect([...silo.secrets.keys()]).toHaveLength(1);
		// ...and the FIRST one is still there. This assertion is the whole item.
		expect((silo.tokens.oauthCredentials as Record<string, unknown>)["openai-codex"]).toMatchObject({
			access: "TOKEN-A",
		});
		expect(result.migratedFromLegacy).toBe(false);
		expect(result.legacyKept).toMatch(/different account/u);
	});

	it("KEEPS the legacy entry when it cannot say whose it is", async () => {
		// A blob with no accountId. Retiring would risk deleting a working credential; keeping it
		// risks a duplicate, which is visible in the catalog and repairable. This module already
		// chose that direction for its write ordering — "a failure at the last step leaves a
		// duplicate, which is visible and repairable" — and the same reasoning decides here.
		const dir = home();
		const silo = fakeSilo({ oauthCredentials: { "openai-codex": { access: "TOKEN-ANONIMO" } } });

		const result = await writeModelCredential({
			home: dir,
			silo,
			provider: "openai-codex",
			credentials: { access: "TOKEN-B", accountId: "conta-b" },
		});

		expect((silo.tokens.oauthCredentials as Record<string, unknown>)["openai-codex"]).toBeDefined();
		expect(result.migratedFromLegacy).toBe(false);
		expect(result.legacyKept).toMatch(/cannot say/u);
	});
});
