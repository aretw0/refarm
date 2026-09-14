import { describe, expect, it } from "vitest";
import { BUDGET_CONFORMANCE_CHECKS, runBudgetConformance } from "./conformance.js";

describe("runBudgetConformance", () => {
	it("passes every check against the reference resolver", () => {
		const report = runBudgetConformance();
		expect(report.failures).toEqual([]);
		expect(report.total).toBe(7);
	});

	it("does not silently shrink the check list", () => {
		expect(BUDGET_CONFORMANCE_CHECKS.length).toBe(7);
	});
});
