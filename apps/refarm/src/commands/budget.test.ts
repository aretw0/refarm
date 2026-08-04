import { describe, expect, it } from "vitest";
import { currentRateTableFrom, outcomeMark, summariseObservations } from "./budget.js";

describe("summariseObservations", () => {
	it("counts the runs the node cut, so a hit ceiling is visible", () => {
		const summary = summariseObservations([
			{ "refarm.outcome": "done", "refarm.budget.bound_by": "declared" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
		]);
		expect(summary).toEqual({
			total: 3,
			timedOut: 2,
			boundByNode: 2,
			boundByWorkspace: 0,
			// None of these three nodes carry `refarm.cost.rate_table_version`, and no
			// `currentRateTable` baseline was given — every one is unstamped, and none
			// can be judged stale against a baseline nobody supplied.
			stalePricing: 0,
			unstampedPricing: 3,
			priceUnknown: 0,
		});
	});

	it("reports zeroes rather than throwing on an empty record", () => {
		expect(summariseObservations([])).toEqual({
			total: 0,
			timedOut: 0,
			boundByNode: 0,
			boundByWorkspace: 0,
			stalePricing: 0,
			unstampedPricing: 0,
			priceUnknown: 0,
		});
	});

	it("counts observations priced by a rate table that is no longer current", () => {
		// Tokens do not drift; prices do. An observation stamped with a
		// superseded rate table still holds true token counts, so its cost is
		// recomputable — but only if the reader can find it.
		const summary = summariseObservations(
			[
				{ "refarm.cost.rate_table_version": "2026-08-03" },
				{ "refarm.cost.rate_table_version": "2026-01-01" },
				{},
			],
			"2026-08-03",
		);
		expect(summary.stalePricing).toBe(1);
		expect(summary.unstampedPricing).toBe(1);
	});

	it("counts a genuine 'no rate on file' apart from a cheap or unstamped run (F5)", () => {
		const summary = summariseObservations([
			// Priced normally.
			{ "refarm.cost.price_known": true },
			// F5's case: estimated_usd is 0.0, but the price was never known.
			{ "refarm.cost.price_known": false },
			// A record written before F5 shipped carries neither key — not
			// counted either way, per D6 (absent is not the same as false).
			{},
		]);
		expect(summary.priceUnknown).toBe(1);
	});
});

describe("currentRateTableFrom", () => {
	it("derives the current version from the newest observation's own stamp", () => {
		const current = currentRateTableFrom([
			{ "refarm.cost.rate_table_version": "2026-01-01", timestamp_ns: 100 },
			{ "refarm.cost.rate_table_version": "2026-08-03.1", timestamp_ns: 300 },
			{ "refarm.cost.rate_table_version": "2026-06-01", timestamp_ns: 200 },
		]);
		expect(current).toBe("2026-08-03.1");
	});

	it("returns undefined when nothing carries both a stamp and a timestamp", () => {
		expect(currentRateTableFrom([])).toBeUndefined();
		expect(currentRateTableFrom([{ "refarm.cost.rate_table_version": "2026-08-03.1" }])).toBeUndefined();
		expect(currentRateTableFrom([{ timestamp_ns: 100 }])).toBeUndefined();
	});
});

describe("outcomeMark", () => {
	it("renders a distinct mark for every outcome the record can carry, including delivered and partial (F2)", () => {
		const marks = new Set(
			["done", "delivered", "partial", "timed-out", "failed", "cancelled"].map(outcomeMark),
		);
		expect(marks.size).toBe(6);
		// An outcome the vocabulary does not (yet) name still renders, via the
		// fallback — it must never throw.
		expect(() => outcomeMark("some-future-outcome")).not.toThrow();
	});
});
