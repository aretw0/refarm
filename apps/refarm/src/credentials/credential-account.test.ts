import { describe, expect, it } from "vitest";

import { compareStoredAccount, describeAccountVerdict } from "./credential-account.js";

const cred = (accountId?: string) => ({
	access: "TOKEN",
	refresh: "R",
	expires: 1,
	...(accountId ? { accountId } : {}),
});

/**
 * ISS-122, the irreversible half. `tokens.oauthCredentials` holds ONE slot per provider, so
 * authenticating a second account of the same provider overwrote the first with no copy kept and no
 * warning — measured against a real silo on 2026-08-12.
 *
 * This does not fix the shape (that is the operator's decision about the credential key). It answers
 * the one question that makes the destruction avoidable: IS THE INCOMING LOGIN THE SAME ACCOUNT?
 */
describe("compareStoredAccount", () => {
	it("calls an empty slot FIRST, which is always safe", () => {
		expect(compareStoredAccount(undefined, cred("a"))).toEqual({ kind: "first" });
		expect(compareStoredAccount(null, cred("a"))).toEqual({ kind: "first" });
	});

	it("calls a matching account SAME — a plain re-authentication, and safe", () => {
		// The common case by far, and it must not be made to feel dangerous: an expired credential
		// re-authenticating as the same account destroys nothing.
		expect(compareStoredAccount(cred("acc-1"), cred("acc-1"))).toEqual({
			kind: "same-account",
			account: "acc-1",
		});
	});

	it("calls a mismatch DIFFERENT-ACCOUNT, naming both", () => {
		// The Copilot personal/corporate case, which is the whole reason this exists.
		expect(compareStoredAccount(cred("pessoal"), cred("corporativa"))).toEqual({
			kind: "different-account",
			stored: "pessoal",
			incoming: "corporativa",
		});
	});

	it("calls a MISSING account unknown, never same", () => {
		// THREE STATES. `accountId` is optional on the credential — `openai-codex.ts` only sets it
		// when it can extract one from the token. Reading absence as "same account" would restore
		// exactly the silent overwrite this file exists to stop, and reading it as "different" would
		// block a legitimate re-auth of a credential stored before accounts were recorded.
		expect(compareStoredAccount(cred(), cred("a")).kind).toBe("unknown");
		expect(compareStoredAccount(cred("a"), cred()).kind).toBe("unknown");
		expect(compareStoredAccount(cred(), cred()).kind).toBe("unknown");
	});

	it("treats a stored value that is not a credential as unknown, not as empty", () => {
		// "There is something here I cannot read" is not "there is nothing here". Reading it as empty
		// would overwrite it.
		expect(compareStoredAccount("a string", cred("a")).kind).toBe("unknown");
		expect(compareStoredAccount(42, cred("a")).kind).toBe("unknown");
	});
});

describe("describeAccountVerdict", () => {
	it("says what is about to be lost, and names the way through", () => {
		const message = describeAccountVerdict(
			{ kind: "different-account", stored: "pessoal", incoming: "corporativa" },
			"github-copilot",
		);
		expect(message).toContain("pessoal");
		expect(message).toContain("corporativa");
		expect(message).toContain("--replace-account");
	});

	it("says nothing for the safe verdicts, so a normal login stays quiet", () => {
		expect(describeAccountVerdict({ kind: "first" }, "openai-codex")).toBeNull();
		expect(
			describeAccountVerdict({ kind: "same-account", account: "a" }, "openai-codex"),
		).toBeNull();
	});

	it("warns on unknown WITHOUT blocking, because nothing proved a loss", () => {
		const message = describeAccountVerdict({ kind: "unknown", reason: "no account" }, "openai-codex");
		expect(message).toMatch(/cannot tell|could not/iu);
	});
});
