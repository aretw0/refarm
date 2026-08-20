import { describe, expect, it } from "vitest";

import { isRefusal, resolveModelAccount } from "./resolve.js";
import { REFUSAL_CODES, type ModelAccountDescriptor } from "./types.js";

const account = (
	alias: string,
	overrides: Partial<ModelAccountDescriptor> = {},
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider: "github-copilot",
	alias,
	identity: { status: "unverified" },
	secretRef: `model/${alias}`,
	health: "healthy",
	revision: "sha256:r1",
	...overrides,
});

const BLUE = account("blue");
const GREEN = account("green");

describe("resolveModelAccount — D3 precedence", () => {
	it("selects the single eligible credential when nothing is bound", () => {
		// Every node that exists today is in this case, and it must not have to declare anything.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: BLUE.credentialId, source: "node-default" });
	});

	it("prefers the WORKSPACE BINDING over the node default", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: GREEN.credentialId }],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: GREEN.credentialId, source: "workspace-binding" });
	});

	it("walks a workspace's seats IN THE ORDER the operator declared them", () => {
		// ISS-157. One binding per workspace made the operator decide the personal/corporate
		// crossing at every refusal. An ORDERED list is that decision made once, in advance —
		// which is why walking it spends nothing he did not name.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [account("first", { health: "unclaimed" }), GREEN],
			bindings: [
				{ workspaceId: "rcdc5", credentialId: account("first").credentialId },
				{ workspaceId: "rcdc5", credentialId: GREEN.credentialId },
			],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: GREEN.credentialId, source: "workspace-binding" });
	});

	it("does not reorder the list to find a healthy seat sooner", () => {
		// The order is an instruction about COST, not a hint. A healthy seat ranked second must not
		// be preferred over a healthy seat ranked first.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [
				{ workspaceId: "rcdc5", credentialId: BLUE.credentialId },
				{ workspaceId: "rcdc5", credentialId: GREEN.credentialId },
			],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: BLUE.credentialId });
	});

	it("refuses when every declared seat is unusable, and names each with its own reason", () => {
		// "NAMED AND UNUSABLE IS A QUESTION, NOT A LICENCE" still holds — it now holds over a list.
		// Falling through to a node default here would spend an account ranked nowhere.
		const stale = account("stale", { health: "unclaimed" });
		const broken = account("broken", { health: "incomplete" });
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [stale, broken, BLUE],
			bindings: [
				{ workspaceId: "rcdc5", credentialId: stale.credentialId },
				{ workspaceId: "rcdc5", credentialId: broken.credentialId },
			],
			workspaceId: "rcdc5",
		});
		expect(isRefusal(result)).toBe(true);
		if (!isRefusal(result)) return;
		// The code is the FIRST seat's, because the operator ranked it first: repairing that one is
		// the action he most wants, and a single code cannot carry two different repairs.
		expect(result.code).toBe(REFUSAL_CODES.unclaimed);
		expect(result.message).toContain("stale");
		expect(result.message).toContain("broken");
		expect(result.candidates.map((c) => c.alias)).toEqual(["stale", "broken"]);
		// And never the unnamed healthy account sitting right there.
		expect(result.message).not.toContain("blue");
	});

	it("still refuses with the single-seat wording when only one is declared", () => {
		// The overwhelming majority of nodes declare one, and their refusal must not grow a list.
		const stale = account("stale", { health: "unclaimed" });
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [stale, BLUE],
			bindings: [{ workspaceId: "rcdc5", credentialId: stale.credentialId }],
			workspaceId: "rcdc5",
		});
		expect(isRefusal(result)).toBe(true);
		if (!isRefusal(result)) return;
		expect(result.code).toBe(REFUSAL_CODES.unclaimed);
		expect(result.candidates).toHaveLength(1);
	});

	it("prefers an explicit dispatch override over the binding", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: GREEN.credentialId }],
			workspaceId: "rcdc5",
			overrideCredentialId: BLUE.credentialId,
		});
		expect(result).toMatchObject({ credentialId: BLUE.credentialId, source: "dispatch-override" });
	});

	it("resolves a workspace WITHOUT inspecting a working directory", () => {
		// The acceptance row "workspace refarm resolves its own binding without inspecting cwd".
		// There is no cwd input to this function at all, which is how the guarantee is kept.
		const both = { provider: "github-copilot", accounts: [BLUE, GREEN] };
		const bindings = [
			{ workspaceId: "rcdc5", credentialId: GREEN.credentialId },
			{ workspaceId: "refarm", credentialId: BLUE.credentialId },
		];
		expect(resolveModelAccount({ ...both, bindings, workspaceId: "refarm" })).toMatchObject({
			credentialId: BLUE.credentialId,
		});
		expect(resolveModelAccount({ ...both, bindings, workspaceId: "rcdc5" })).toMatchObject({
			credentialId: GREEN.credentialId,
		});
	});
});

describe("resolveModelAccount — refusals", () => {
	it("REFUSES two eligible credentials with no binding, naming safe candidates", () => {
		// The row this whole slice exists for. Choosing the last login, the newest, or the first key
		// would be a guess wearing an answer's clothes — and it would spend the corporate quota on
		// personal work, silently.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(isRefusal(result)).toBe(true);
		expect(result).toMatchObject({ code: REFUSAL_CODES.ambiguous });
		expect((result as { candidates: { alias: string }[] }).candidates.map((c) => c.alias)).toEqual([
			"blue",
			"green",
		]);
	});

	it("carries NO secret and no subject in a refusal", () => {
		// A refusal is printed on any surface, including a phone and a log.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [account("blue", { identity: { status: "verified", subject: "github:99" } }), GREEN],
			bindings: [],
			workspaceId: null,
		});
		expect(JSON.stringify(result)).not.toContain("github:99");
	});

	it("refuses NONE differently from ambiguous", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ code: REFUSAL_CODES.none });
	});

	it("does not count an INCOMPLETE entry as eligible, and says so when it is the only one", () => {
		// D2: a descriptor whose secret is missing is never "healthy" and never routable. Counting it
		// would produce a snapshot pointing at a secret that is not there.
		const broken = account("blue", { health: "incomplete" });
		expect(
			resolveModelAccount({
				provider: "github-copilot",
				accounts: [broken],
				bindings: [],
				workspaceId: null,
			}),
		).toMatchObject({ code: REFUSAL_CODES.incomplete });
	});

	it("ignores an UNCLAIMED entry when a healthy one exists, rather than calling it ambiguous", () => {
		// An orphaned secret must not make a working single-account node refuse.
		const orphan = account("ghost", { health: "unclaimed" });
		expect(
			resolveModelAccount({
				provider: "github-copilot",
				accounts: [BLUE, orphan],
				bindings: [],
				workspaceId: null,
			}),
		).toMatchObject({ credentialId: BLUE.credentialId });
	});

	it("refuses an override naming a credential that is not eligible", () => {
		// An override is authorised, not magic: it may not reach an entry the catalog says is broken.
		expect(
			isRefusal(
				resolveModelAccount({
					provider: "github-copilot",
					accounts: [BLUE, account("green", { health: "incomplete" })],
					bindings: [],
					workspaceId: null,
					overrideCredentialId: GREEN.credentialId,
				}),
			),
		).toBe(true);
	});

	it("ignores a binding for a DIFFERENT provider", () => {
		// Aliases are unique only within a provider, and bindings are per workspace: a kimi binding
		// must not select a copilot credential or suppress its ambiguity.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: "model-account:KIMIXXXXXXXXXXXXXXXXXXXXXX" }],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ code: REFUSAL_CODES.ambiguous });
	});
});

/**
 * ISS-131 — THE BINDING DRIVES THE ROUTE, on the operator's ruling of 2026-08-17.
 *
 * `provider` used to filter first and everything else happened inside it, so a binding could only
 * ever disambiguate WITHIN the route's provider. The comment above that behaviour justified it with
 * "a workspace may be bound per provider" — a shape the store cannot express: `modelBindings` is
 * one credential per workspace.
 *
 * Measured on the operator's node, both of his bindings inert:
 *
 *     config.json  refarm -> K4NX... (github-copilot, corporativo)
 *     route        openai-codex/gpt-5.5
 *     resolved     openai-codex / account-2 / source: node-default
 *
 * His ruling: a workspace-scoped run is decided by that workspace's binding; a node-level run by
 * whatever the node is associated with. So `provider` is what the node would use ABSENT a binding.
 */
describe("resolveModelAccount — a workspace binding outranks the route's provider", () => {
	const CODEX = account("codex", { provider: "openai-codex" });

	it("selects the bound account even when the route names another provider", () => {
		const result = resolveModelAccount({
			provider: "openai-codex",
			accounts: [CODEX, BLUE],
			bindings: [{ workspaceId: "refarm", credentialId: BLUE.credentialId }],
			workspaceId: "refarm",
		});
		expect(result).toMatchObject({
			provider: "github-copilot",
			credentialId: BLUE.credentialId,
			source: "workspace-binding",
		});
	});

	it("REFUSES when the bound account is on this node and not usable", () => {
		// Falling through would spend a DIFFERENT account than the one the operator named, silently,
		// and report it as a node default. A binding is an instruction about cost; an unusable one is
		// a question, not a licence to choose.
		const broken = account("broken", { health: "incomplete" });
		const result = resolveModelAccount({
			provider: "openai-codex",
			accounts: [CODEX, broken],
			bindings: [{ workspaceId: "refarm", credentialId: broken.credentialId }],
			workspaceId: "refarm",
		});
		expect(isRefusal(result)).toBe(true);
		expect(result).toMatchObject({ code: REFUSAL_CODES.incomplete });
	});

	it("leaves a NODE-LEVEL run to the route, because no workspace is asking", () => {
		const result = resolveModelAccount({
			provider: "openai-codex",
			accounts: [CODEX, BLUE],
			bindings: [{ workspaceId: "refarm", credentialId: BLUE.credentialId }],
			workspaceId: null,
		});
		expect(result).toMatchObject({ provider: "openai-codex", source: "node-default" });
	});

	it("still falls through when the binding names a credential this node does not hold", () => {
		// A dangling binding names nothing to act on. `credential bind` refuses unknown ids and
		// `forget` refuses while bound, so this is an anomaly rather than a choice — and acting on it
		// would mean inventing which account it meant.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "refarm", credentialId: "model-account:GONEXXXXXXXXXXXXXXXXXXXXXX" }],
			workspaceId: "refarm",
		});
		expect(result).toMatchObject({ code: REFUSAL_CODES.ambiguous });
	});
});
