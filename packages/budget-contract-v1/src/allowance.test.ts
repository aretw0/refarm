import { describe, expect, it } from "vitest";

import { checkWorkspaceAllowance, readWorkspaceAllowances } from "./allowance.js";

/**
 * ISS-064 step 3, the capping half — and NOT the per-dispatch fold.
 *
 * Measured 2026-08-18: `resolveBudget` bounds ONE dispatch. It cannot stop a workspace from
 * making five hundred dispatches of one request each, which is how an operator's shared seat went
 * from 1706 premium interactions remaining to zero. Protecting a seat is a per-PERIOD question,
 * and this is where it is answered.
 */
describe("readWorkspaceAllowances", () => {
	it("reads a declared per-period allowance", () => {
		expect(
			readWorkspaceAllowances({ workspaceAllowances: { refarm: { maxRequestsPerMonth: 400 } } }),
		).toEqual([{ workspaceId: "refarm", maxRequestsPerMonth: 400 }]);
	});

	it("reads a node that declared nothing as bounding nothing", () => {
		// Adopting this must not cap a node that never asked to be capped.
		expect(readWorkspaceAllowances({})).toEqual([]);
		expect(readWorkspaceAllowances(undefined)).toEqual([]);
	});

	it("keeps a declared ZERO, which is a real refusal and not an absent declaration", () => {
		expect(
			readWorkspaceAllowances({ workspaceAllowances: { paused: { maxRequestsPerMonth: 0 } } }),
		).toEqual([{ workspaceId: "paused", maxRequestsPerMonth: 0 }]);
	});

	it("drops an entry whose limit is not a usable number rather than treating it as zero", () => {
		// A malformed limit read as 0 would silently stop all work for that workspace — the
		// opposite of what a typo should cost.
		expect(
			readWorkspaceAllowances({
				workspaceAllowances: { a: { maxRequestsPerMonth: "400" }, b: {}, c: { maxRequestsPerMonth: -1 } },
			}),
		).toEqual([]);
	});
});

describe("checkWorkspaceAllowance", () => {
	const allowances = [{ workspaceId: "refarm", maxRequestsPerMonth: 10 }];

	it("permits a workspace nobody declared an allowance for", () => {
		expect(checkWorkspaceAllowance("rcdc5", 999, allowances)).toEqual({ state: "unbounded" });
	});

	it("permits while under the allowance, and says how much is left", () => {
		expect(checkWorkspaceAllowance("refarm", 4, allowances)).toEqual({
			state: "within",
			spent: 4,
			allowed: 10,
			remaining: 6,
		});
	});

	it("REFUSES at the allowance, not one past it", () => {
		// Spending the tenth request of ten leaves nothing; the eleventh is the one refused, and
		// the boundary is where an off-by-one costs a seat.
		expect(checkWorkspaceAllowance("refarm", 9, allowances).state).toBe("within");
		expect(checkWorkspaceAllowance("refarm", 10, allowances)).toMatchObject({
			state: "exceeded",
			spent: 10,
			allowed: 10,
		});
	});

	it("refuses a declared zero immediately", () => {
		expect(checkWorkspaceAllowance("paused", 0, [{ workspaceId: "paused", maxRequestsPerMonth: 0 }])).toMatchObject({
			state: "exceeded",
		});
	});

	it("says CANNOT-CHECK when the spend could not be counted, and does not pretend either way", () => {
		// Refusing work because the record was unreadable would make the node unusable whenever the
		// runtime is down. Permitting SILENTLY would make the allowance a fiction. The third state
		// permits and says so, which is the only honest option.
		const verdict = checkWorkspaceAllowance("refarm", null, allowances);
		expect(verdict.state).toBe("cannot-check");
		expect("permits" in verdict && verdict.permits).toBe(true);
	});

	it("does not claim to bound the PROVIDER's meter", () => {
		// The load-bearing limit: other clients and other nodes spend the same seat. This bounds
		// what THIS node dispatches for one workspace, and the wording must not overreach.
		const verdict = checkWorkspaceAllowance("refarm", 10, allowances);
		expect("because" in verdict && verdict.because).toMatch(/this node/iu);
		expect("because" in verdict && verdict.because).not.toMatch(/provider'?s (meter|quota) is/iu);
	});
});
