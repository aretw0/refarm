import { describe, expect, it } from "vitest";

import {
	authorizedAccounts,
	authorizedProviders,
	describeAuthorization,
	readModelAuthorization,
} from "./authorization.js";
import type { ModelAccountDescriptor } from "./types.js";

const account = (
	alias: string,
	provider: string,
	health: ModelAccountDescriptor["health"] = "healthy",
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider,
	alias,
	identity: { status: "verified", subject: alias },
	secretRef: `model/${alias}`,
	health,
	revision: "sha256:r",
});

const CORP = account("corporativo", "github-copilot");
const PESSOAL = account("pessoal", "github-copilot");
const CODEX = account("account-2", "openai-codex");
const HELD = [CORP, PESSOAL, CODEX];

describe("readModelAuthorization", () => {
	it("reads a config that has said nothing as UNDECLARED", () => {
		expect(readModelAuthorization({})).toEqual({ scope: "undeclared" });
		expect(readModelAuthorization(undefined)).toEqual({ scope: "undeclared" });
		expect(readModelAuthorization({ modelBindings: {} })).toEqual({ scope: "undeclared" });
	});

	it("reads blanket approval, with the date it was given", () => {
		expect(
			readModelAuthorization({ modelAuthorization: { scope: "all", declaredAt: "2026-08-17" } }),
		).toEqual({ scope: "all", declaredAt: "2026-08-17" });
	});

	it("reads a named list, by opaque id", () => {
		expect(
			readModelAuthorization({
				modelAuthorization: { scope: "declared", accounts: [CORP.credentialId] },
			}),
		).toEqual({ scope: "declared", accounts: [CORP.credentialId] });
	});

	it("reads a MALFORMED declaration as undeclared, never as all", () => {
		// Every failure of this parser must land on the state that authorises nothing. The
		// alternative is a typo widening what a node may spend, silently, in the direction of cost.
		expect(readModelAuthorization({ modelAuthorization: "all" })).toEqual({ scope: "undeclared" });
		expect(readModelAuthorization({ modelAuthorization: { scope: "everything" } })).toEqual({
			scope: "undeclared",
		});
		expect(readModelAuthorization({ modelAuthorization: [] })).toEqual({ scope: "undeclared" });
	});

	it("keeps an EMPTY declared list as a declaration, not as silence", () => {
		// The operator said "these" and named none. That authorises nothing and it is not the same
		// as never having chosen — which is the whole distinction this contract exists to carry.
		expect(readModelAuthorization({ modelAuthorization: { scope: "declared", accounts: [] } })).toEqual(
			{ scope: "declared", accounts: [] },
		);
	});

	it("drops non-string entries rather than carrying them into an allowlist", () => {
		expect(
			readModelAuthorization({
				modelAuthorization: { scope: "declared", accounts: [CORP.credentialId, 7, null, "  "] },
			}),
		).toEqual({ scope: "declared", accounts: [CORP.credentialId] });
	});
});

describe("authorizedAccounts", () => {
	it("authorises NOTHING when nobody has declared", () => {
		// Adopting this must not change a node that has said nothing: the host resolves its own
		// primary route and treats the authorised set as an ADDITION, so an empty set is today.
		expect(authorizedAccounts({ scope: "undeclared" }, HELD).authorized).toEqual([]);
	});

	it("authorises every HEALTHY account under blanket approval", () => {
		const broken = account("broken", "kimi-api", "incomplete");
		const result = authorizedAccounts({ scope: "all" }, [...HELD, broken]);
		expect(result.authorized.map((a) => a.alias)).toEqual(["corporativo", "pessoal", "account-2"]);
	});

	it("does not authorise an unusable account even under blanket approval", () => {
		// "Everything this node holds" is about permission, not repair. An `incomplete` account has
		// no secret to spend, and offering it sends a dispatch at a credential that is not there.
		const broken = account("broken", "kimi-api", "incomplete");
		expect(authorizedAccounts({ scope: "all" }, [broken]).authorized).toEqual([]);
	});

	it("authorises exactly the named accounts", () => {
		const result = authorizedAccounts(
			{ scope: "declared", accounts: [CORP.credentialId, CODEX.credentialId] },
			HELD,
		);
		expect(result.authorized.map((a) => a.alias)).toEqual(["corporativo", "account-2"]);
	});

	it("REPORTS a declared account this node does not hold, rather than dropping it", () => {
		// A declaration naming an account that is gone is stale, not satisfied. Dropping it silently
		// would make an authorization that no longer means what it says look like it still does.
		const result = authorizedAccounts(
			{ scope: "declared", accounts: [CORP.credentialId, "model-account:GONEXXXXXXXXXXXXXXXXXXXXXX"] },
			HELD,
		);
		expect(result.unknown).toEqual(["model-account:GONEXXXXXXXXXXXXXXXXXXXXXX"]);
		expect(result.authorized.map((a) => a.alias)).toEqual(["corporativo"]);
	});

	it("separates UNKNOWN from UNUSABLE, because one is stale and the other is repairable", () => {
		const broken = account("broken", "kimi-api", "incomplete");
		const result = authorizedAccounts(
			{ scope: "declared", accounts: [broken.credentialId, "model-account:GONEXXXXXXXXXXXXXXXXXXXXXX"] },
			[...HELD, broken],
		);
		expect(result.unusable).toEqual([broken.credentialId]);
		expect(result.unknown).toEqual(["model-account:GONEXXXXXXXXXXXXXXXXXXXXXX"]);
	});
});

describe("authorizedProviders", () => {
	it("collapses two accounts of one provider into one provider", () => {
		// This becomes an egress allowlist: it bounds WHERE the host may send. Which account pays is
		// decided above it, by the binding.
		expect(authorizedProviders(authorizedAccounts({ scope: "all" }, HELD))).toEqual([
			"github-copilot",
			"openai-codex",
		]);
	});

	it("is empty for an undeclared node, which is exactly today's behaviour", () => {
		expect(authorizedProviders(authorizedAccounts({ scope: "undeclared" }, HELD))).toEqual([]);
	});

	it("is stable in order, so an allowlist can be diffed between boots", () => {
		const once = authorizedProviders(authorizedAccounts({ scope: "all" }, HELD));
		const again = authorizedProviders(authorizedAccounts({ scope: "all" }, HELD));
		expect(once).toEqual(again);
	});
});

describe("describeAuthorization", () => {
	it("tells an undeclared node what it has not said, without calling it a fault", () => {
		const text = describeAuthorization({ scope: "undeclared" }, { authorized: [], unknown: [], unusable: [] });
		expect(text).toMatch(/has not declared/u);
		// THE FACT, NOT THE COMMAND. A generic contract naming one CLI's verb cannot be reused by
		// another surface; the handoff is rendered where every other one is, from `nextCommands`.
		expect(text).not.toMatch(/refarm /u);
	});

	it("says NOTHING when a declaration is satisfied", () => {
		const auth = { scope: "declared", accounts: [CORP.credentialId] } as const;
		expect(describeAuthorization(auth, authorizedAccounts(auth, HELD))).toBeNull();
		expect(describeAuthorization({ scope: "all" }, authorizedAccounts({ scope: "all" }, HELD))).toBeNull();
	});

	it("names a stale declaration as stale rather than as satisfied", () => {
		const auth = { scope: "declared", accounts: ["model-account:GONEXXXXXXXXXXXXXXXXXXXXXX"] } as const;
		expect(describeAuthorization(auth, authorizedAccounts(auth, HELD))).toMatch(/stale, not satisfied/u);
	});

	it("says an empty declaration reaches nothing, so it does not read as approval", () => {
		const auth = { scope: "declared", accounts: [] } as const;
		expect(describeAuthorization(auth, authorizedAccounts(auth, HELD))).toMatch(/names no account/u);
	});
});
