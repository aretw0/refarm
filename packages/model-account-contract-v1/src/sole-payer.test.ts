import { describe, expect, it } from "vitest";

import { solePayerFor } from "./sole-payer.js";
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

/**
 * WHO PAID, when nobody declared it.
 *
 * Measured 2026-08-18: 36 of 57 budget observations named no account. They were dispatched from
 * directories with no workspace binding — and they still spent a real seat. The seat is knowable
 * exactly when the provider has one, and this function refuses to guess in every other case.
 */
describe("solePayerFor", () => {
	it("names the payer when the provider has exactly one healthy account", () => {
		// 34 of the 36 unattributed dispatches were openai-codex, which this node holds one of.
		expect(solePayerFor("openai-codex", [CORP, PESSOAL, CODEX])?.alias).toBe("account-2");
	});

	it("REFUSES when the provider has two, because the seat is genuinely unknown", () => {
		// This is the honest half: with two seats and no binding, nothing here knows which one the
		// host chose. Naming either would attribute spend to a seat that may not have paid.
		expect(solePayerFor("github-copilot", [CORP, PESSOAL, CODEX])).toBeNull();
	});

	it("ignores an unusable account rather than counting it toward the ambiguity", () => {
		// An `incomplete` account has no secret to spend, so it cannot have paid — and letting it
		// make the answer ambiguous would lose an attribution that is actually determined.
		const broken = account("broken", "openai-codex", "incomplete");
		expect(solePayerFor("openai-codex", [CODEX, broken])?.alias).toBe("account-2");
	});

	it("returns nothing for a provider this node holds no account of", () => {
		expect(solePayerFor("anthropic", [CORP, CODEX])).toBeNull();
	});

	it("returns nothing when every account of the provider is unusable", () => {
		// Not the same as "one account": there is nothing here that could have paid, and saying
		// otherwise would invent a payer for spend that came from somewhere else entirely.
		expect(solePayerFor("openai-codex", [account("broken", "openai-codex", "incomplete")])).toBeNull();
	});
});
