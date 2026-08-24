import { describe, expect, it } from "vitest";

import { quotaRefusalDetail } from "./ask-errors.js";

/**
 * ISS-157, question 1, which tier 1 left untouched.
 *
 * MEASURED on the operator's node 2026-08-20, with the corporate seat exhausted:
 *
 *     refarm credential quota
 *       pessoal      individual  premium_interactions  1500/1500   chat unlimited
 *       corporativo  business    premium_interactions     0/10000  chat unlimited
 *
 *     refarm ask --workspace refarm 'responda apenas: ok'   (bound to corporativo)
 *       -> "Model quota or billing limit reached."
 *          Inspect route: refarm model current
 *          Reconfigure:   refarm sow
 *          List providers: refarm model providers
 *
 * Not one of the three suggested steps is the situation, and the headline is false as a statement
 * about the account: `chat` and `completions` were UNLIMITED on that same seat. The node had
 * already read all of it and said none of it.
 *
 * WHAT THIS FUNCTION MAY SAY is bounded by what the refusal path holds WITHOUT a second network
 * call to the provider that just refused: the seats tried, by alias, and the command that answers
 * the meter question. Which meter, its numbers and its reset date belong to `credential quota` —
 * asking for them here would put a request on a failure path and could itself fail.
 */
describe("what a quota refusal can say from what the node already holds", () => {
	const seats = [{ credentialId: "model-account:CORP", alias: "corporativo" }];

	it("names the seat that refused, instead of the account in general", async () => {
		const lines = quotaRefusalDetail({
			provider: "github-copilot",
			tried: seats,
			declaredExhausted: true,
		});

		expect(lines.join("\n")).toMatch(/corporativo/u);
	});

	it("routes to the one surface that answers which meter and how much is left", async () => {
		// `credential quota` already reads it per account. ISS-157: "nothing routes an operator
		// there at the moment he needs it."
		const lines = quotaRefusalDetail({
			provider: "github-copilot",
			tried: seats,
			declaredExhausted: true,
		});

		expect(lines.join("\n")).toMatch(/refarm credential quota/u);
	});

	it("says the DECLARED order ran out, which is what actually happened", async () => {
		// A declared list is exclusive: having exhausted it the walk refuses rather than falling to
		// an unnamed seat. An operator who reads "quota reached" cannot tell that from "this node
		// has nothing left anywhere".
		const lines = quotaRefusalDetail({
			provider: "github-copilot",
			tried: seats,
			declaredExhausted: true,
		});

		expect(lines.join("\n")).toMatch(/declared/iu);
	});

	it("NEVER offers a command that switches the binding", async () => {
		// The personal/corporate frontier is the operator's. ISS-157: "a node that silently spends
		// a personal seat for corporate work has crossed it without being asked. The gap is
		// INFORMATION, not policy." Question 1 — whether the refusal should offer `credential bind`
		// — is his to answer, and until he does, this must not answer it for him.
		const lines = quotaRefusalDetail({
			provider: "github-copilot",
			tried: seats,
			declaredExhausted: true,
		});

		expect(lines.join("\n")).not.toMatch(/credential bind/u);
	});

	it("says nothing it did not measure when no seat was identified", async () => {
		// A dispatch with no resolvable seat still refuses. Naming a seat here would invent one.
		const lines = quotaRefusalDetail({
			provider: "github-copilot",
			tried: [],
			declaredExhausted: false,
		});

		expect(lines.join("\n")).not.toMatch(/declared/iu);
		expect(lines.join("\n")).toMatch(/refarm credential quota/u);
	});
});
