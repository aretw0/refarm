import { describe, expect, it } from "vitest";

import { isMeterExhausted, meteredEntries, type AccountQuota } from "./quota.js";

/**
 * VOCABULARY ONLY. The readers that turn one provider's body into these states, and the recorded
 * fixtures that pin them, moved with the parsing to `@refarm.dev/github-copilot-wire` (ISS-142).
 *
 * What is left here is deliberately built from the STATES rather than from a provider's JSON: a
 * generic contract's own suite must not depend on a vendor's field names, or the split it just
 * made is only cosmetic.
 */
const quota = (meters: AccountQuota["meters"]): AccountQuota => ({ meters });

describe("isMeterExhausted", () => {
	it("is THREE-VALUED, so unmeasured never reads as plenty", () => {
		// A boolean would make "we could not ask" indistinguishable from "there is plenty", which is
		// the shape that lets a node report health it never established.
		expect(isMeterExhausted({ kind: "unlimited" })).toBe(false);
		expect(isMeterExhausted({ kind: "cannot-say", reason: "x" })).toBeUndefined();
		expect(
			isMeterExhausted({
				kind: "metered",
				entitlement: 10,
				remaining: 0,
				percentRemaining: 0,
				overagePermitted: true,
				overageCount: 3,
			}),
		).toBe(true);
	});

	it("calls a seat with room NOT exhausted, overage or not", () => {
		// The operator's corporate seat, as its numbers read on 2026-08-17: 3004 of 10000 left, and
		// overage permitted. Neither fact makes it out.
		expect(
			isMeterExhausted({
				kind: "metered",
				entitlement: 10_000,
				remaining: 3004,
				percentRemaining: 30,
				overagePermitted: true,
				overageCount: 0,
			}),
		).toBe(false);
	});
});

describe("meteredEntries", () => {
	it("returns only the meters a denominator can come from", () => {
		// `unlimited` has no denominator and `cannot-say` has no measurement — neither can carry one.
		expect(
			meteredEntries(
				quota({
					chat: { kind: "unlimited" },
					unknown: { kind: "cannot-say", reason: "the provider stated nothing" },
					premium_interactions: {
						kind: "metered",
						entitlement: 10_000,
						remaining: 3004,
						percentRemaining: 30,
						overagePermitted: true,
						overageCount: 0,
					},
				}),
			).map(([id]) => id),
		).toEqual(["premium_interactions"]);
	});
});
