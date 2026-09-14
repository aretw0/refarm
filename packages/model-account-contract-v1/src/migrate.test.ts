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
			secretRef: "legacy:oauthCredentials/openai-codex",
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
		// The descriptor travels to `credential list`. No token material may be in it.
		//
		// THE ACCOUNT ID USED TO BE EXCLUDED HERE TOO, on the reading that it is "upstream
		// identity" — and that exclusion is what ISS-128 turned out to be. The new-credential path
		// has always stored it as `identity.subject`, and the operator's own catalog proves the
		// contract already treats it as a descriptor field: his two github-copilot accounts each
		// carry a subject, which is exactly what lets them coexist and be told apart. The legacy
		// path withheld the one field that distinguishes accounts, so a second login had nothing
		// to compare and deleted the first.
		//
		// A subject is not a secret: `model-accounts.json` is mode 644 BY DESIGN, because a
		// descriptor is not credential material. What must never appear is below.
		const accounts = readLegacyCredentials({
			oauthCredentials: {
				"openai-codex": { access: "SECRET-TOKEN", refresh: "R", expires: 1, accountId: "acc-1" },
			},
		});
		const serialised = JSON.stringify(accounts);
		expect(serialised).not.toContain("SECRET-TOKEN");
		expect(serialised).not.toContain("\"R\"");
		expect(serialised).toContain("acc-1");
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

describe("a legacy credential's own identity", () => {
	// MEASURED 2026-08-16 (ISS-128), in a redirected-SILO_HOME lab against the real write path: a
	// legacy `openai-codex` holding account A, then a login for account B with a different
	// accountId, and A's secret was gone — deleted by the by-provider retirement in
	// `account-write.ts` step 3, which reported `migratedFromLegacy: true`.
	//
	// The information to tell A from B was NEVER missing. It sits in the legacy blob as
	// `accountId`, and this function took only the provider and never opened the blob, hardcoding
	// `unverified` with no subject. With no subject there is nothing to compare, so every
	// comparison downstream had to assume sameness.

	it("carries the account id the legacy blob already holds", () => {
		const [descriptor] = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "t", accountId: "aaaa-1111" } },
		});

		expect(descriptor.identity.subject).toBe("aaaa-1111");
	});

	it("stays unverified even when it knows the subject", () => {
		// The provider did not confirm anything in THIS session — the id was read off a stored blob.
		// `verified` travels into budget and status output where identity claims are believed, so
		// knowing WHO does not license claiming CONFIRMED.
		const [descriptor] = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "t", accountId: "aaaa-1111" } },
		});

		expect(descriptor.identity.status).toBe("unverified");
	});

	it("leaves the subject absent when the blob never had one", () => {
		// Absence stays absence. Inventing a subject here would make two different accounts look
		// like one, which is the failure this whole item is about, only harder to see.
		const [descriptor] = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "t" } },
		});

		expect(descriptor.identity.subject).toBeUndefined();
		expect(descriptor.identity.status).toBe("unverified");
	});
});
