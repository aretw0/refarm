import { describe, expect, it } from "vitest";

import { LEGACY_ALIAS, readLegacyCredentials } from "./migrate.js";

/**
 * The migration is ADDITIVE AND REVERSIBLE (spec, "Migration and compatibility"): legacy entries are
 * READ as accounts, never rewritten. Nothing here writes; nothing dual-writes a secret value.
 */
describe("readLegacyCredentials", () => {
	it("reads a flat oauth entry as an implicit <provider>/default account", () => {
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "T", expires: 1, accountId: "acc-1" } },
		});
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			provider: "openai-codex",
			alias: LEGACY_ALIAS,
			secretRef: "model/openai-codex",
		});
	});

	it("marks a legacy identity UNVERIFIED until a provider verifies it", () => {
		// Step 2 of the migration. A credential refarm inherited was never checked against its
		// provider, and claiming otherwise would put a false `verified` into budget and status output.
		const [account] = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "T", expires: 1 } },
		});
		expect(account?.identity).toEqual({ status: "unverified" });
	});

	it("carries NO secret material into the descriptor", () => {
		// The descriptor travels to `credential list`. The access token must not be in it, and
		// neither must the account id, which is upstream identity.
		const accounts = readLegacyCredentials({
			oauthCredentials: {
				"openai-codex": { access: "SECRET-TOKEN", refresh: "R", expires: 1, accountId: "acc-1" },
			},
		});
		const serialised = JSON.stringify(accounts);
		expect(serialised).not.toContain("SECRET-TOKEN");
		expect(serialised).not.toContain("acc-1");
	});

	it("reads an API-key provider too, which has the same one-slot limitation", () => {
		expect(
			readLegacyCredentials({ modelProvider: "anthropic", modelApiKey: "sk-x" })[0],
		).toMatchObject({ provider: "anthropic", alias: LEGACY_ALIAS });
	});

	it("does not double-count a provider present in BOTH shapes", () => {
		// A silo holding an oauth entry and naming the same provider as its API model would otherwise
		// produce two descriptors for one credential, and the resolver would call it ambiguous.
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "T" } },
			modelProvider: "openai-codex",
			modelApiKey: "sk-x",
		});
		expect(accounts).toHaveLength(1);
	});

	it("returns nothing for an empty silo rather than inventing an account", () => {
		expect(readLegacyCredentials({})).toEqual([]);
		expect(readLegacyCredentials({ oauthCredentials: {} })).toEqual([]);
	});

	it("gives each legacy provider a DISTINCT opaque id", () => {
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "A" }, "github-copilot": { access: "B" } },
		});
		expect(new Set(accounts.map((a) => a.credentialId)).size).toBe(2);
	});

	it("survives a malformed silo instead of throwing", () => {
		// This reads the operator's real file. A shape nobody predicted must degrade to "no accounts
		// found", never to a crash in the command that was going to report the problem.
		expect(readLegacyCredentials({ oauthCredentials: "not an object" as never })).toEqual([]);
		expect(readLegacyCredentials({ modelProvider: 42 as never, modelApiKey: "k" })).toEqual([]);
	});
});
