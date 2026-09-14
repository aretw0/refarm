/** The contract version this package implements. */
export const BUDGET_CONTRACT_VERSION = "budget:v1";

/** The three axes a spawner may declare. Every field is optional; an omitted
 *  axis falls back to the workspace default, then the node default. */
export type BudgetDeclaration = {
	/** Wall-clock deadline for the whole dispatch. */
	deadlineMs?: number;
	/** Cumulative tokens across the dispatch, not per call. */
	maxTokens?: number;
	/** Estimated spend. Only binds under `api` pricing mode. */
	maxUsd?: number;
};

/** A ceiling has the same shape as a declaration; it is read as a maximum. */
export type BudgetCeiling = BudgetDeclaration;

export type BudgetAxis = "deadlineMs" | "maxTokens" | "maxUsd";

export const BUDGET_AXES: readonly BudgetAxis[] = [
	"deadlineMs",
	"maxTokens",
	"maxUsd",
];

/** Which level produced the effective value. */
export type BudgetLevel = "node" | "workspace" | "declared" | "default";

export type ResolvedAxis = {
	/** The value that will actually govern the run. */
	effective: number;
	/** What the spawner asked for, or null if it asked for nothing. */
	declared: number | null;
	/** Which level produced `effective`. Never inferred by the reader. */
	boundBy: BudgetLevel;
};

export type ResolvedBudget = Record<BudgetAxis, ResolvedAxis>;

/** The node always has a complete default and a complete ceiling: it is the
 *  machine, and it always knows what it can serve. A workspace may declare
 *  either, both, or neither. */
export type BudgetResolutionInput = {
	declared?: BudgetDeclaration;
	workspace?: { ceiling?: BudgetCeiling; default?: BudgetDeclaration };
	node: { ceiling: Required<BudgetCeiling>; default: Required<BudgetDeclaration> };
};
