import { describe, expect, it } from "vitest";

import {
	formatSelectionRefusal,
	knownSelections,
	resolveModelProviderSelection,
} from "./model-provider-selection.js";

/**
 * The world as it is today: `anthropic` is reachable BOTH ways, `openai-codex` only by
 * subscription, the rest only by key. `github-copilot` is in neither inventory while being a real
 * model provider — which is the case these tests exist for most.
 */
const INVENTORIES = {
	oauth: ["openai-codex", "anthropic"],
	apiKey: ["openai", "anthropic", "groq", "mistral", "gemini", "xai", "deepseek", "together", "openrouter"],
};

const resolve = (value: string) => resolveModelProviderSelection(value, INVENTORIES);

describe("resolveModelProviderSelection", () => {
	it("sends a subscription-only provider straight to its login", () => {
		// The operator's actual ask: skip the picker and log into openai-codex.
		expect(resolve("openai-codex")).toEqual({ kind: "oauth", id: "openai-codex" });
	});

	it("sends a key-only provider straight to its key prompt", () => {
		expect(resolve("groq")).toEqual({ kind: "api", id: "groq" });
	});

	it("keeps ollama keyless", () => {
		expect(resolve("ollama")).toEqual({ kind: "ollama" });
	});

	it("REFUSES to choose when a provider offers both, rather than picking one", () => {
		// A subscription and an API key are different accounts, different billing, different quotas.
		// Picking silently is the same class of act as writing a value into his configuration for
		// him — which is the accident this session started with (ISS-121).
		expect(resolve("anthropic")).toEqual({
			kind: "ambiguous",
			id: "anthropic",
			qualified: ["anthropic:subscription", "anthropic:key"],
		});
		const refusal = formatSelectionRefusal(resolve("anthropic"));
		expect(refusal).toContain("--model-provider anthropic:subscription");
		expect(refusal).toContain("--model-provider anthropic:key");
	});

	it("honours the qualified forms", () => {
		expect(resolve("anthropic:subscription")).toEqual({ kind: "oauth", id: "anthropic" });
		expect(resolve("anthropic:key")).toEqual({ kind: "api", id: "anthropic" });
	});

	it("rejects a qualifier the provider does not offer, instead of falling back to the other", () => {
		// `openai-codex:key` must not quietly become the OAuth flow. A qualifier is the operator
		// being explicit; honouring a different one would ignore the explicitness.
		expect(resolve("openai-codex:key").kind).toBe("unknown");
		expect(resolve("groq:subscription").kind).toBe("unknown");
	});

	it("names a KNOWN provider with no login flow as exactly that, not as unknown", () => {
		// github-copilot is the operator's corporate quota. It is in MODEL_PROVIDERS, the runtime
		// understands it, `refarm model providers` lists it — and no credential flow exists here
		// (ISS-122). Calling it "unknown" would send him to check his spelling.
		const selection = resolve("github-copilot");
		expect(selection.kind).toBe("no-credential-flow");
		expect(formatSelectionRefusal(selection)).toContain("no login or key flow is implemented");
		expect(formatSelectionRefusal(selection)).toContain("refarm model providers");
	});

	it("calls a genuine typo unknown, and lists what would have worked", () => {
		const selection = resolve("opnai");
		expect(selection.kind).toBe("unknown");
		const refusal = formatSelectionRefusal(selection);
		expect(refusal).toContain("openai");
		expect(refusal).toContain("ollama");
	});

	it("trims and lowercases, because a copied value carries whitespace and case", () => {
		expect(resolve("  OpenAI-Codex ")).toEqual({ kind: "oauth", id: "openai-codex" });
	});

	it("an empty value is unknown rather than a silent default", () => {
		expect(resolve("").kind).toBe("unknown");
	});
});

describe("knownSelections", () => {
	it("qualifies only the providers that need it", () => {
		const known = knownSelections(INVENTORIES);
		// anthropic appears twice, qualified; openai-codex and groq appear bare.
		expect(known).toContain("anthropic:subscription");
		expect(known).toContain("anthropic:key");
		expect(known).not.toContain("anthropic");
		expect(known).toContain("openai-codex");
		expect(known).toContain("groq");
		expect(known).toContain("ollama");
	});

	it("is sorted, so two runs produce the same error message", () => {
		expect(knownSelections(INVENTORIES)).toEqual([...knownSelections(INVENTORIES)].sort());
	});
});

describe("formatSelectionRefusal", () => {
	it("says nothing when the selection resolved", () => {
		expect(formatSelectionRefusal({ kind: "oauth", id: "openai-codex" })).toBeNull();
		expect(formatSelectionRefusal({ kind: "ollama" })).toBeNull();
	});
});
