import { resolveBudget } from "./resolve.js";
import type { BudgetResolutionInput, ResolvedBudget } from "./types.js";

export type BudgetResolver = (input: BudgetResolutionInput) => ResolvedBudget;

export type ConformanceCheck = {
	name: string;
	input: BudgetResolutionInput;
	axis: "deadlineMs" | "maxTokens" | "maxUsd";
	expect: { effective: number; declared: number | null; boundBy: string };
};

export type ConformanceReport = {
	total: number;
	passed: number;
	failures: { name: string; expected: unknown; actual: unknown }[];
};

// The same node fixture resolve.test.ts uses — kept in lockstep so a check here and
// its behaviour there never drift apart silently.
const node = {
	ceiling: { deadlineMs: 600_000, maxTokens: 500_000, maxUsd: 10 },
	default: { deadlineMs: 45_000, maxTokens: 100_000, maxUsd: 1 },
};

/** The checks, as data. A Rust or WASM implementation runs the same list. */
export const BUDGET_CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
	{
		name: "uses the node default when nobody declares anything",
		input: { node },
		axis: "deadlineMs",
		expect: { effective: 45_000, declared: null, boundBy: "default" },
	},
	{
		name: "lets the spawner declare above the default and below the ceiling",
		input: { node, declared: { deadlineMs: 300_000 } },
		axis: "deadlineMs",
		expect: { effective: 300_000, declared: 300_000, boundBy: "declared" },
	},
	{
		name: "clamps to the node ceiling and says the node did it",
		input: { node, declared: { deadlineMs: 9_000_000 } },
		axis: "deadlineMs",
		expect: { effective: 600_000, declared: 9_000_000, boundBy: "node" },
	},
	{
		name: "clamps to a tighter workspace ceiling and says the workspace did it",
		input: {
			node,
			workspace: { ceiling: { deadlineMs: 120_000 } },
			declared: { deadlineMs: 300_000 },
		},
		axis: "deadlineMs",
		expect: { effective: 120_000, declared: 300_000, boundBy: "workspace" },
	},
	{
		name: "refuses to let a workspace grant capacity the node does not have",
		input: {
			node,
			workspace: { ceiling: { deadlineMs: 9_000_000 } },
			declared: { deadlineMs: 9_000_000 },
		},
		axis: "deadlineMs",
		expect: { effective: 600_000, declared: 9_000_000, boundBy: "node" },
	},
	{
		name: "prefers a workspace default over the node default",
		input: { node, workspace: { default: { deadlineMs: 90_000 } } },
		axis: "deadlineMs",
		expect: { effective: 90_000, declared: null, boundBy: "default" },
	},
	{
		name: "resolves each axis independently",
		input: { node, declared: { deadlineMs: 9_000_000, maxTokens: 1_000 } },
		axis: "maxTokens",
		expect: { effective: 1_000, declared: 1_000, boundBy: "declared" },
	},
];

export function runBudgetConformance(
	resolve: BudgetResolver = resolveBudget,
): ConformanceReport {
	const failures: ConformanceReport["failures"] = [];
	for (const check of BUDGET_CONFORMANCE_CHECKS) {
		const actual = resolve(check.input)[check.axis];
		if (
			actual.effective !== check.expect.effective ||
			actual.declared !== check.expect.declared ||
			actual.boundBy !== check.expect.boundBy
		) {
			failures.push({ name: check.name, expected: check.expect, actual });
		}
	}
	return {
		total: BUDGET_CONFORMANCE_CHECKS.length,
		passed: BUDGET_CONFORMANCE_CHECKS.length - failures.length,
		failures,
	};
}
