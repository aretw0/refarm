import { describe, expect, it } from "vitest";

import { buildAccountView } from "./account-view.js";
import { describeNewCredential } from "./describe-new.js";
import type { ModelAccountDescriptor } from "./types.js";

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

	/**
	 * ISS-132. `presentRefs` used to declare every `legacy:` ref present "by definition — their
	 * secret is the flat map entry that produced the descriptor". True of a descriptor this call
	 * derived from `tokens`; false of one read out of the catalog file, which is a SECOND origin the
	 * invariant never saw. Measured on the operator's node: catalog holding the ref, silo holding
	 * `oauthCredentials: {}`, and `credential list` calling it healthy.
	 */
	describe("a legacy ref is present because the flat map says so, never because of its shape", () => {
		const FOSSIL: ModelAccountDescriptor = {
			credentialId: "model-account:CG4WNKR6KNSH3510XGHBWW0JXA",
			provider: "openai-codex",
			alias: "default",
			identity: { status: "unverified" },
			secretRef: "legacy:oauthCredentials/openai-codex",
			health: "healthy",
			revision: "sha256:legacy",
		};

		it("calls a stored legacy descriptor INCOMPLETE once its flat entry is gone", () => {
			const view = buildAccountView({
				tokens: { oauthCredentials: {} },
				catalog: [FOSSIL],
				secrets: new Map(),
			});
			expect(view.accounts.find((a) => a.credentialId === FOSSIL.credentialId)?.health).toBe(
				"incomplete",
			);
			expect(view.credentialFor("openai-codex")).toMatchObject({ kind: "incomplete" });
		});

		it("still calls it healthy while the flat entry it names is there", () => {
			// The invariant the old code MEANT, kept: a legacy secret lives in the token map and is
			// never looked for in the namespaced store. Losing this would report every un-migrated
			// node's working credential as broken.
			const view = buildAccountView({ tokens: TOKENS, catalog: [FOSSIL], secrets: new Map() });
			expect(view.accounts.find((a) => a.credentialId === FOSSIL.credentialId)?.health).toBe(
				"healthy",
			);
			expect(view.credentialFor("openai-codex")).toMatchObject({ kind: "found" });
		});

		it("keeps counting a fossil as legacy, so the transition cannot look finished while it exists", () => {
			// `legacyAccounts` is the number that licenses deleting the legacy branch. A stored
			// descriptor nobody can service must keep that number off zero until it is removed.
			const view = buildAccountView({
				tokens: { oauthCredentials: {} },
				catalog: [FOSSIL],
				secrets: new Map(),
			});
			expect(view.legacyAccounts.map((a) => a.credentialId)).toEqual([FOSSIL.credentialId]);
		});
	});
});
