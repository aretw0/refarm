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
		expect(silo.secrets.get(`model/${descriptor.credentialId}`)).toContain("TOKEN-A");
		expect(readCatalog(dir).map((e) => e.credentialId)).toEqual([descriptor.credentialId]);
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
		const silo = fakeSilo({
			oauthCredentials: { "openai-codex": { access: "OLD" }, "kimi-api": { access: "KEEP" } },
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
		expect(again.descriptor.credentialId).toBe(first.descriptor.credentialId);
		expect(readCatalog(dir)).toHaveLength(1);
		expect(silo.secrets.get(`model/${again.descriptor.credentialId}`)).toContain("FRESH");
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
			secrets: new Map([[descriptor.secretRef, JSON.parse(silo.secrets.get(descriptor.secretRef)!)]]),
		});
		expect(view.credentialFor("github-copilot")).toMatchObject({ kind: "found" });
		expect(view.legacyAccounts).toEqual([]);
	});
});
