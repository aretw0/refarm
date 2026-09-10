import { describe, expect, it } from "vitest";

import { attributeMeter, readMeterUsageFacts } from "./meter-usage.js";

/**
 * ISS-073 step 3. Measured 2026-08-18: the provider does not say, per dispatch, which meter it
 * spent — twelve response headers, none about quota. So the only honest source is this node's own
 * measurement, and a measurement has a date.
 */
const FACTS = [
	{ provider: "github-copilot", model: "gpt-4o", meter: "premium_interactions", consumes: false, measuredAt: "2026-08-18" },
];

describe("readMeterUsageFacts", () => {
	it("reads a declared, DATED measurement", () => {
		expect(readMeterUsageFacts({ modelMeters: FACTS })).toEqual(FACTS);
	});

	it("drops an entry with no measurement date, because an undated fact cannot be re-checked", () => {
		const { model, ...rest } = FACTS[0]!;
		void model;
		expect(readMeterUsageFacts({ modelMeters: [{ ...rest, model: "x", measuredAt: undefined }] })).toEqual([]);
	});

	it("reads a node that declared nothing as having measured nothing", () => {
		expect(readMeterUsageFacts({})).toEqual([]);
		expect(readMeterUsageFacts({ modelMeters: "all" })).toEqual([]);
	});
});

describe("attributeMeter", () => {
	it("attributes NONE when every model dispatched was measured not to spend this meter", () => {
		// The useful case, and the operator's real one: gpt-4o moved neither premium meter across a
		// live before/after read. "refarm consumed none of your 8294" is a fact, not an unknown.
		const attribution = attributeMeter("premium_interactions", [{ provider: "github-copilot", model: "gpt-4o" }], FACTS);
		expect(attribution.kind).toBe("none");
		expect(attribution.because).toMatch(/measured/iu);
	});

	it("falls to UNKNOWN the moment one dispatched model was never measured", () => {
		// One unmeasured model poisons the claim: "none" would assert something about traffic
		// nobody looked at. The whole set has to be covered or the answer is unknown.
		const attribution = attributeMeter(
			"premium_interactions",
			[{ provider: "github-copilot", model: "gpt-4o" }, { provider: "github-copilot", model: "claude-sonnet-4" }],
			FACTS,
		);
		expect(attribution.kind).toBe("unknown");
		expect(attribution.because).toMatch(/claude-sonnet-4/u);
	});

	it("stays UNKNOWN when a model IS measured to spend the meter, because the amount is not 1:1", () => {
		// Copilot publishes per-model multipliers for premium interactions. Knowing a model spends
		// the meter does not say HOW MUCH, and counting one dispatch as one interaction would be a
		// rate this node invented.
		const facts = [{ ...FACTS[0]!, consumes: true }];
		const attribution = attributeMeter("premium_interactions", [{ provider: "github-copilot", model: "gpt-4o" }], facts);
		expect(attribution.kind).toBe("unknown");
		expect(attribution.because).toMatch(/how much|multiplier|rate/iu);
	});

	it("attributes NONE when nothing was dispatched, because not dispatching cannot spend", () => {
		// The one case that needs no measurement at all: a node that sent nothing consumed nothing.
		expect(attributeMeter("premium_interactions", [], FACTS).kind).toBe("none");
	});

	it("does not let a fact about ANOTHER provider's model cover this one", () => {
		const attribution = attributeMeter(
			"premium_interactions",
			[{ provider: "openai-codex", model: "gpt-4o" }],
			FACTS,
		);
		expect(attribution.kind).toBe("unknown");
	});
});
