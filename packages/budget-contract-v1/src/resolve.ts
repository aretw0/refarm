import {
	BUDGET_AXES,
	type BudgetAxis,
	type BudgetResolutionInput,
	type ResolvedAxis,
	type ResolvedBudget,
} from "./types.js";

/**
 * Resolve one value across three nested levels (D9). Outward to inward: the node
 * bounds what it can serve, the scope bounds within that, and the request declares
 * within both. A scope ceiling above the node's is clamped rather than obeyed — a
 * scope cannot grant capacity the machine lacks. Kept generic on purpose: budget is
 * this fold's first consumer, and a later policy (e.g. per-workspace auth) resolves
 * through the same three levels.
 */
function resolveAxis(
	axis: BudgetAxis,
	input: BudgetResolutionInput,
): ResolvedAxis {
	const nodeCeiling = input.node.ceiling[axis];
	const workspaceCeiling = input.workspace?.ceiling?.[axis];
	const declared = input.declared?.[axis];
	const fallback = input.workspace?.default?.[axis] ?? input.node.default[axis];

	const ceiling =
		workspaceCeiling === undefined
			? nodeCeiling
			: Math.min(workspaceCeiling, nodeCeiling);

	const requested = declared ?? fallback;

	// Within the ceiling: whoever supplied the number gets the credit.
	if (requested <= ceiling) {
		return {
			effective: requested,
			declared: declared ?? null,
			boundBy: declared === undefined ? "default" : "declared",
		};
	}

	// Clamped: name the level that actually cut it, so raising the wrong ceiling
	// is not the operator's next move.
	const cutByWorkspace =
		workspaceCeiling !== undefined && workspaceCeiling <= nodeCeiling;
	return {
		effective: ceiling,
		declared: declared ?? null,
		boundBy: cutByWorkspace ? "workspace" : "node",
	};
}

/**
 * Resolve a spawner's declared budget (`BudgetDeclaration`) across the node's
 * ceiling/default and an optional workspace ceiling/default — one axis
 * (`deadlineMs`, `maxTokens`, `maxUsd`) at a time. The node bounds what the machine
 * can serve, the workspace bounds within that, and the dispatch declares within
 * both (D9).
 */
export function resolveBudget(input: BudgetResolutionInput): ResolvedBudget {
	return Object.fromEntries(
		BUDGET_AXES.map((axis) => [axis, resolveAxis(axis, input)]),
	) as ResolvedBudget;
}
