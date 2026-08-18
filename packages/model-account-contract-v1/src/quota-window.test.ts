import { describe, expect, it } from "vitest";

import { quotaWindowFor } from "./quota-window.js";

/**
 * The window is what makes the two counts comparable. A provider meter resets on a date; a count
 * of this node's dispatches that spans a different period is the units error moved into time.
 */
describe("quotaWindowFor", () => {
	it("reads the month ENDING at a first-of-month reset", () => {
		// Measured shape: github-copilot answers resetsAt "2026-09-01" for the August period.
		expect(quotaWindowFor("2026-09-01")).toEqual({
			spec: "2026-08",
			source: "derived-from-reset",
		});
	});

	it("crosses the year boundary the way a calendar does", () => {
		expect(quotaWindowFor("2026-01-01")).toEqual({
			spec: "2025-12",
			source: "derived-from-reset",
		});
	});

	it("REFUSES a reset that is not a month boundary rather than guessing the period", () => {
		// A mid-month reset could be monthly-from-signup, weekly, or something else. Guessing
		// would produce a window that looks measured and is not.
		expect(quotaWindowFor("2026-09-17")).toBeNull();
	});

	it("says nothing when the provider stated no reset at all", () => {
		expect(quotaWindowFor(undefined)).toBeNull();
		expect(quotaWindowFor("")).toBeNull();
		expect(quotaWindowFor("not-a-date")).toBeNull();
	});

	it("marks the window as DERIVED, never as declared", () => {
		// The provider gives an end date and a sku that says "monthly". The window is an inference
		// from those two, and a reader deciding whether to trust the comparison needs to know that.
		expect(quotaWindowFor("2026-09-01")?.source).toBe("derived-from-reset");
	});
});
