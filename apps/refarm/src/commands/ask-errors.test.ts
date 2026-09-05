import { describe, expect, it } from "vitest";

import { buildAskErrorPayload, quotaRefusalDetail } from "./ask-errors.js";

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


/**
 * THE SAME REFUSAL, SAID THE SAME WAY — ISS-157's own named STILL OPEN item.
 *
 * MEASURED on the operator's node 2026-08-25, one dispatch apart, corporate seat at 0/10000:
 *
 *     refarm ask --workspace refarm          "Seat refused: github-copilot corporativo"
 *                                            "Which meter, and what is left: refarm credential quota"
 *     refarm ask --workspace refarm --json    error/message and FOUR commands about the route,
 *                                             no seat, no workspace, no `credential quota`
 *
 * The human half shipped 2026-08-24 and the JSON half did not, so the surface an AGENT consumes
 * kept describing a situation that was not the one that happened.
 *
 * AND IT SPENT. The fourth command was `refarm model openai/<ref> --json`, which reaches the model
 * group's bare-ref sugar (`resolveModelGrammar`) and WRITES the route — node-scoped, so every
 * workspace follows it — from a subscription provider to `openai`, recorded in
 * docs/model-provider-strata.md:17 as public pay-as-you-go API pricing and holding no credential
 * on this node. AGENTS.md section 4 tells an agent to follow `nextCommand`. So a meter emptying on
 * one seat instructed the fleet to start paying per token.
 */
describe("the JSON refusal describes the same event as the human one", () => {
	const QUOTA = "[runtime-agent error] HTTP 429: quota exceeded";
	const context = {
		provider: "github-copilot",
		tried: [{ credentialId: "model-account:CORP", alias: "corporativo" }],
		declaredExhausted: true,
	};

	/** Every `refarm model …` action that only READS. Taken from the model capability group's own
	 * action set (`model-capability.ts`): current/providers/doctor/env read, set/fallback/reset/
	 * base-url write — and anything that is not an action at all is the bare-ref sugar, which
	 * writes too. Phrasing the guard this way catches the WHOLE class rather than the one
	 * provider that happened to be hardcoded, which would have shared the defect's own blind spot. */
	const READ_ONLY_MODEL_ACTIONS = new Set(["current", "providers", "doctor", "env"]);

	const routeWriters = (commands: readonly string[]) =>
		commands.filter((command) => {
			const match = /^refarm model (\S+)/u.exec(command);
			return match !== null && !READ_ONLY_MODEL_ACTIONS.has(match[1]!);
		});

	it("names the seat that refused, which the human rendering already did", async () => {
		const payload = buildAskErrorPayload(QUOTA, context);

		expect(payload.seats?.map((seat) => seat.alias)).toEqual(["corporativo"]);
		expect(payload.provider).toBe("github-copilot");
	});

	it("routes to the one surface that answers which meter and how much is left", async () => {
		const payload = buildAskErrorPayload(QUOTA, context);

		expect(payload.nextCommand).toBe("refarm credential quota --json");
	});

	it("says the DECLARED order ran out, as a field an agent can branch on", async () => {
		expect(buildAskErrorPayload(QUOTA, context).declaredExhausted).toBe(true);
	});

	it("NEVER hands back a command that writes the node's route", async () => {
		// The measured hazard, and the reason this guard is phrased over the model grammar rather
		// than over one provider name. A quota limit on a subscription seat is not a reason to
		// rewrite the route — least of all toward metered billing, and least of all node-wide when
		// the refusal belonged to one workspace's binding (ISS-131's operator ruling).
		const payload = buildAskErrorPayload(QUOTA, context);

		expect(routeWriters(payload.nextCommands ?? [])).toEqual([]);
		expect(routeWriters(payload.nextActions)).toEqual([]);
	});

	it("NEVER offers to reconfigure credentials, which are not what refused", async () => {
		// `refarm sow` is a login/reconfigure. Nothing about the credential failed — it
		// authenticated fine and the provider answered about a meter.
		const payload = buildAskErrorPayload(QUOTA, context);

		expect(payload.nextCommands?.join(" ")).not.toMatch(/refarm sow/u);
	});

	it("NEVER offers a command that switches the binding", async () => {
		// Mirrors the human guard exactly. The personal/corporate frontier is the operator's, and
		// an agent reading JSON must not be handed the crossing the operator was not offered.
		const payload = buildAskErrorPayload(QUOTA, context);

		expect(JSON.stringify(payload)).not.toMatch(/credential bind/u);
	});

	it("says nothing it did not measure when no walk was handed in", async () => {
		// Every OTHER caller of this payload builder passes no context. An empty `seats: []` would
		// read as "nothing was tried"; absent reads as "this path did not know", which is true.
		const payload = buildAskErrorPayload(QUOTA);

		expect(payload.seats).toBeUndefined();
		expect(payload.declaredExhausted).toBeUndefined();
		expect(payload.nextCommand).toBe("refarm credential quota --json");
	});
});
