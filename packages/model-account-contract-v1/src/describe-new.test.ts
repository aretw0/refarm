import { describe, expect, it } from "vitest";

import { describeNewCredential, nextFreeAlias } from "./describe-new.js";
import { credentialSecretLocation } from "./secret-location.js";
import type { ModelAccountDescriptor } from "./types.js";

const existing = (provider: string, alias: string): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider,
	alias,
	identity: { status: "unverified" },
	secretRef: `model/x-${alias}`,
	health: "healthy",
	revision: "sha256:r1",
});

describe("nextFreeAlias", () => {
	it("names the first account of a provider `default`", () => {
		expect(nextFreeAlias("github-copilot", [])).toBe("default");
	});

	it("counts up rather than colliding, because aliases are unique per provider", () => {
		const one = [existing("github-copilot", "default")];
		expect(nextFreeAlias("github-copilot", one)).toBe("account-2");
		expect(nextFreeAlias("github-copilot", [...one, existing("github-copilot", "account-2")])).toBe(
			"account-3",
		);
	});

	it("ignores another provider's aliases, because uniqueness is per provider", () => {
		expect(nextFreeAlias("kimi-api", [existing("github-copilot", "default")])).toBe("default");
	});

	it("skips a taken name even out of order", () => {
		expect(
			nextFreeAlias("p", [existing("p", "default"), existing("p", "account-3")]),
		).toBe("account-2");
	});
});

describe("describeNewCredential", () => {
	const base = { provider: "github-copilot", secretDigest: "sha256:abc", existing: [] };

	it("puts the secret in the MODEL NAMESPACE, keyed by the opaque id", () => {
		const descriptor = describeNewCredential({ ...base, accountId: "acct-1" });
		expect(credentialSecretLocation(descriptor)).toEqual({
			kind: "namespaced",
			namespace: "model",
			id: descriptor.credentialId,
		});
	});

	it("gives the SAME id for the same account, so a re-login replaces rather than duplicates", () => {
		// The acceptance row "re-login account-03 → blue secret and revision are unchanged" needs the
		// id to be a function of the account, never of the moment or the alias.
		const a = describeNewCredential({ ...base, accountId: "acct-1" });
		const b = describeNewCredential({ ...base, accountId: "acct-1", alias: "renamed-since" });
		expect(b.credentialId).toBe(a.credentialId);
	});

	it("gives DIFFERENT ids to different accounts of one provider", () => {
		// The whole point: personal and corporate coexist instead of overwriting.
		expect(describeNewCredential({ ...base, accountId: "pessoal" }).credentialId).not.toBe(
			describeNewCredential({ ...base, accountId: "corporativa" }).credentialId,
		);
	});

	it("carries NO account id into the id itself", () => {
		// The id reaches logs, status and budget exports, where only the id may travel.
		expect(describeNewCredential({ ...base, accountId: "arthur@example" }).credentialId).not.toContain(
			"arthur",
		);
	});

	it("marks identity VERIFIED only when the provider issued an account id", () => {
		// An account id extracted from the provider's own token is the provider telling us who this
		// is. Without one, nothing was confirmed, and claiming otherwise would put a false `verified`
		// into budget and status output.
		expect(describeNewCredential({ ...base, accountId: "acct-1" }).identity).toEqual({
			status: "verified",
			subject: "acct-1",
		});
		expect(describeNewCredential(base).identity).toEqual({ status: "unverified" });
	});

	it("takes the operator's alias when given, and never lets it change the id", () => {
		const named = describeNewCredential({ ...base, accountId: "acct-1", alias: "corporativa" });
		expect(named.alias).toBe("corporativa");
		expect(named.credentialId).toBe(
			describeNewCredential({ ...base, accountId: "acct-1" }).credentialId,
		);
	});

	it("moves the revision when the secret moves, so a snapshot can pin what it selected", () => {
		const before = describeNewCredential({ ...base, accountId: "a", secretDigest: "sha256:1" });
		const after = describeNewCredential({ ...base, accountId: "a", secretDigest: "sha256:2" });
		expect(after.revision).not.toBe(before.revision);
		expect(after.credentialId).toBe(before.credentialId);
	});
});
