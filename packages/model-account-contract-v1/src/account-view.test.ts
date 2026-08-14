import { describe, expect, it } from "vitest";

import { buildAccountView } from "./account-view.js";
import { describeNewCredential } from "./describe-new.js";

const TOKENS = { oauthCredentials: { "openai-codex": { access: "LEGACY", expires: 1 } } };

const NAMESPACED = describeNewCredential({
	provider: "github-copilot",
	accountId: "corporativa",
	existing: [],
	secretDigest: "sha256:d",
});

/**
 * ONE VIEW, ASSEMBLED ONCE PER INVOCATION.
 *
 * Readers are synchronous and pure, and the namespaced secret store is not. Rather than make five
 * call sites async, the caller loads everything once and hands over a view. That also means a
 * command answers every credential question from a single consistent snapshot, instead of
 * re-reading between two questions and getting two different worlds.
 */
describe("buildAccountView", () => {
	it("sees a legacy credential and a namespaced one side by side", () => {
		const view = buildAccountView({
			tokens: TOKENS,
			catalog: [NAMESPACED],
			secrets: new Map([[NAMESPACED.secretRef, { access: "NEW" }]]),
		});
		expect(view.accounts.map((a) => a.provider).sort()).toEqual(["github-copilot", "openai-codex"]);
	});

	it("reads each one from its OWN store", () => {
		const view = buildAccountView({
			tokens: TOKENS,
			catalog: [NAMESPACED],
			secrets: new Map([[NAMESPACED.secretRef, { access: "NEW" }]]),
		});
		expect(view.credentialFor("openai-codex")).toMatchObject({ kind: "found" });
		expect((view.credentialFor("openai-codex") as { credential: { access: string } }).credential.access).toBe(
			"LEGACY",
		);
		expect((view.credentialFor("github-copilot") as { credential: { access: string } }).credential.access).toBe(
			"NEW",
		);
	});

	it("REFUSES when one provider has two eligible accounts and nothing said which", () => {
		// The whole point of the contract, reached through the view a command actually holds.
		const second = describeNewCredential({
			provider: "github-copilot",
			accountId: "pessoal",
			existing: [NAMESPACED],
			secretDigest: "sha256:e",
		});
		const view = buildAccountView({
			tokens: {},
			catalog: [NAMESPACED, second],
			secrets: new Map([
				[NAMESPACED.secretRef, { access: "A" }],
				[second.secretRef, { access: "B" }],
			]),
		});
		expect(view.credentialFor("github-copilot")).toMatchObject({ kind: "ambiguous" });
	});

	it("resolves the ambiguity from a binding, without inspecting anything else", () => {
		const second = describeNewCredential({
			provider: "github-copilot",
			accountId: "pessoal",
			existing: [NAMESPACED],
			secretDigest: "sha256:e",
		});
		const view = buildAccountView({
			tokens: {},
			catalog: [NAMESPACED, second],
			secrets: new Map([
				[NAMESPACED.secretRef, { access: "A" }],
				[second.secretRef, { access: "B" }],
			]),
			bindings: [{ workspaceId: "rcdc5", credentialId: second.credentialId }],
			workspaceId: "rcdc5",
		});
		expect((view.credentialFor("github-copilot") as { credential: { access: string } }).credential.access).toBe(
			"B",
		);
	});

	it("says a descriptor whose secret is missing is INCOMPLETE, not absent", () => {
		// The secret write failed, or was removed underneath. The descriptor is evidence the login
		// happened, and the operator repairs this differently from "never logged in".
		const view = buildAccountView({ tokens: {}, catalog: [NAMESPACED], secrets: new Map() });
		expect(view.credentialFor("github-copilot")).toMatchObject({ kind: "incomplete" });
	});

	it("says NONE for a provider nothing knows about", () => {
		expect(buildAccountView({ tokens: {}, catalog: [], secrets: new Map() }).credentialFor("kimi-api"))
			.toMatchObject({ kind: "none" });
	});

	it("counts what is still legacy, so a migration can know when it is done", () => {
		// The dual-read exists only while un-migrated credentials do. This is the number that says
		// when the legacy path can be deleted rather than maintained forever.
		const view = buildAccountView({
			tokens: TOKENS,
			catalog: [NAMESPACED],
			secrets: new Map([[NAMESPACED.secretRef, { access: "NEW" }]]),
		});
		expect(view.legacyAccounts.map((a) => a.provider)).toEqual(["openai-codex"]);

		const migrated = buildAccountView({ tokens: {}, catalog: [NAMESPACED], secrets: new Map() });
		expect(migrated.legacyAccounts).toEqual([]);
	});
});
