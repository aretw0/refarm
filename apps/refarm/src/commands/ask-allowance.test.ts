import { describe, expect, it } from "vitest";

import { allowanceForDispatch, currentMonth, effectiveAllowances } from "./ask-allowance.js";

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

/**
 * The operator's consolidation, 2026-08-19: the workspace announces a baseline, the node grants.
 * These hold the boundary at the place it is actually crossed — the gate that refuses a dispatch.
 */
describe("effectiveAllowances", () => {
	const node = { workspaceAllowances: { refarm: { maxRequestsPerMonth: 400 } } };

	it("lets a workspace announce a TIGHTER baseline for itself", () => {
		const effective = effectiveAllowances("refarm", node, {
			workspaceAllowances: { refarm: { maxRequestsPerMonth: 50 } },
		});
		expect(effective).toEqual([{ workspaceId: "refarm", maxRequestsPerMonth: 50 }]);
	});

	it("REFUSES to let a workspace widen what the node granted", () => {
		// A repository that could raise its own allowance by shipping a config file would spend the
		// operator's seat by being cloned. This is the whole reason the node holds the grant.
		const effective = effectiveAllowances("refarm", node, {
			workspaceAllowances: { refarm: { maxRequestsPerMonth: 9_000 } },
		});
		expect(effective).toEqual([{ workspaceId: "refarm", maxRequestsPerMonth: 400 }]);
	});

	it("honours an announcement the node never answered", () => {
		// Asking to be bounded where nobody bounded you is not an escalation.
		expect(effectiveAllowances("solo", {}, { workspaceAllowances: { solo: { maxRequestsPerMonth: 30 } } })).toEqual([
			{ workspaceId: "solo", maxRequestsPerMonth: 30 },
		]);
	});

	it("does not let one workspace's announcement touch another's grant", () => {
		const effective = effectiveAllowances("refarm", node, {
			workspaceAllowances: { rcdc5: { maxRequestsPerMonth: 1 } },
		});
		expect(effective).toEqual([{ workspaceId: "refarm", maxRequestsPerMonth: 400 }]);
	});

	it("refuses through the gate at the tightened number, not the granted one", () => {
		// The announcement has to reach the REFUSAL, not just the reconciliation — a rule that
		// stops one function short of the gate is a rule nothing enforces.
		const verdict = allowanceForDispatch(
			"refarm",
			node,
			[
				{ timestamp_ns: Date.UTC(2026, 7, 2) * 1e6, "refarm.budget.credentialId": "a", "refarm.workspace.id": "refarm" },
				{ timestamp_ns: Date.UTC(2026, 7, 3) * 1e6, "refarm.budget.credentialId": "a", "refarm.workspace.id": "refarm" },
			],
			NOW,
			{ workspaceAllowances: { refarm: { maxRequestsPerMonth: 2 } } },
		);
		expect(verdict.state).toBe("exceeded");
	});
});
