import { describe, expect, it } from "vitest";

import { allowanceForDispatch, currentMonth } from "./ask-allowance.js";

const NOW = Date.UTC(2026, 7, 20);
const CONFIG = { workspaceAllowances: { refarm: { maxRequestsPerMonth: 3 } } };
const obs = (ms: number, workspace: string, account = "acct-a") => ({
	timestamp_ns: ms * 1_000_000,
	"refarm.budget.credentialId": account,
	"refarm.workspace.id": workspace,
});

describe("currentMonth", () => {
	it("bounds the UTC calendar month containing the instant", () => {
		const period = currentMonth(NOW);
		expect(period.startMs).toBe(Date.UTC(2026, 7, 1));
		expect(period.endMs).toBe(Date.UTC(2026, 8, 1));
		expect(period.spec).toBe("2026-08");
	});
});

describe("allowanceForDispatch", () => {
	it("permits when the node declared no allowance at all", () => {
		expect(allowanceForDispatch("refarm", {}, [], NOW)).toEqual({ state: "unbounded" });
	});

	it("permits a workspace nobody bounded, even when others are bounded", () => {
		expect(allowanceForDispatch("rcdc5", CONFIG, [], NOW).state).toBe("unbounded");
	});

	it("counts only this month's dispatches for this workspace", () => {
		const verdict = allowanceForDispatch(
			"refarm",
			CONFIG,
			[
				obs(Date.UTC(2026, 7, 2), "refarm"),
				obs(Date.UTC(2026, 6, 28), "refarm"), // last month — the meter reset since
				obs(Date.UTC(2026, 7, 3), "rcdc5"), // someone else's spend
			],
			NOW,
		);
		expect(verdict).toMatchObject({ state: "within", spent: 1, remaining: 2 });
	});

	it("SUMS across accounts, so an exhausted workspace cannot hop to the next seat", () => {
		// The allowance bounds the WORKSPACE. Counting per account would let one workspace spend
		// its full cap on every seat the node holds, which is the opposite of protecting them.
		const verdict = allowanceForDispatch(
			"refarm",
			CONFIG,
			[
				obs(Date.UTC(2026, 7, 2), "refarm", "acct-a"),
				obs(Date.UTC(2026, 7, 3), "refarm", "acct-b"),
				obs(Date.UTC(2026, 7, 4), "refarm", "acct-c"),
			],
			NOW,
		);
		expect(verdict.state).toBe("exceeded");
	});

	it("PERMITS and says so when the record could not be read", () => {
		// Not zero spend. Refusing here would make the node unusable whenever its runtime is down,
		// which is exactly when an operator needs it most.
		const verdict = allowanceForDispatch("refarm", CONFIG, null, NOW);
		expect(verdict.state).toBe("cannot-check");
		expect("permits" in verdict && verdict.permits).toBe(true);
	});
});
