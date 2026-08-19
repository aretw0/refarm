/**
 * REFUSING BEFORE SPENDING.
 *
 * `budget quota` shows a workspace's standing against its declared allowance. Showing is not
 * stopping: measured 2026-08-18, the operator's shared seat went from 1706 premium interactions
 * remaining to zero, and every ceiling that existed bounded a single dispatch rather than a month
 * of them.
 *
 * This is the gate. It counts what THIS NODE already dispatched for a workspace in the current UTC
 * calendar month and refuses the next one when the allowance is spent.
 *
 * THREE OUTCOMES, and the third is why this can exist on a hot path at all: a record that cannot
 * be read yields `cannot-check`, which PERMITS and says so. Refusing work because the runtime is
 * down would make the node unusable exactly when the operator most needs it; permitting in silence
 * would make the allowance a fiction.
 */
import {
	checkWorkspaceAllowance,
	readWorkspaceAllowances,
	reconcileAnnouncedAllowance,
	type AllowanceVerdict,
	type WorkspaceAllowance,
} from "@refarm.dev/budget-contract-v1";

import { dispatchedPerAccount, type ObservationNode, type ResolvedPeriod } from "./budget.js";

/** PURE. The UTC calendar month containing `nowMs`, as the counter's window. */
export function currentMonth(nowMs: number): ResolvedPeriod {
	const now = new Date(nowMs);
	const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
	const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
	return {
		kind: "calendar-month",
		startMs: start,
		endMs: end,
		spec: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
		label: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
	};
}

/**
 * PURE. What the allowance says about dispatching for this workspace right now.
 *
 * `observations` is `null` when the record could not be read — which is not zero spend, and the
 * difference is the whole point of the third state.
 */
export function allowanceForDispatch(
	workspaceId: string | undefined,
	config: unknown,
	observations: readonly ObservationNode[] | null,
	nowMs: number,
	/** What the WORKSPACE announced about itself, if it announced anything. A need stated, never
	 *  a grant held — see `reconcileAnnouncedAllowance`. */
	workspaceConfig?: unknown,
): AllowanceVerdict {
	if (!workspaceId) return { state: "unbounded" };
	const allowances = effectiveAllowances(workspaceId, config, workspaceConfig);
	if (allowances.length === 0) return { state: "unbounded" };
	if (observations === null) return checkWorkspaceAllowance(workspaceId, null, allowances);

	const counted = dispatchedPerAccount(observations, currentMonth(nowMs));
	// Summed across accounts on purpose: the allowance bounds what the WORKSPACE dispatches, and a
	// workspace that exhausted one seat must not simply move to the next one under the same cap.
	let spent = 0;
	for (const shares of counted.workspacesByAccount.values()) {
		spent += shares.get(workspaceId) ?? 0;
	}
	return checkWorkspaceAllowance(workspaceId, spent, allowances);
}

/**
 * Read the record for the gate, or `null` when it cannot be read.
 *
 * NEVER throws. A dispatch must not fail because the spend could not be counted — that lands on
 * `cannot-check`, which permits and says so.
 */
export async function readSpendForAllowance(
	limit = 500,
): Promise<readonly ObservationNode[] | null> {
	try {
		const { fetchBudgetObservations } = await import("./budget.js");
		return (await fetchBudgetObservations(limit)).observations;
	} catch {
		return null;
	}
}

/**
 * The credential this dispatch would spend, read for its stated expiry only.
 *
 * NEVER throws and never returns the secret — the caller wants one fact: has it lapsed. A read
 * failure yields `null`, which the staleness check reports as `unknown` rather than as fresh.
 */
export async function boundCredentialFor(credentialId: string | undefined): Promise<unknown> {
	if (!credentialId) return null;
	try {
		const { SiloCore } = await import("@refarm.dev/silo");
		const { loadAccountCredentials } = await import("../credentials/account-view-loader.js");
		const { resolveRefarmHome } = await import("../utils/refarm-home.js");
		const credentials = await loadAccountCredentials({
			home: resolveRefarmHome(),
			silo: new SiloCore() as never,
		});
		return credentials.get(credentialId) ?? null;
	} catch {
		return null;
	}
}

/**
 * PURE. The node's grants, with the workspace's own announcement folded in where it TIGHTENS.
 *
 * The announcement is read from the workspace's config under the same key. It cannot widen: a
 * repository that could raise its own allowance by shipping a file would spend the operator's seat
 * by being cloned.
 */
export function effectiveAllowances(
	workspaceId: string,
	nodeConfig: unknown,
	workspaceConfig: unknown,
): WorkspaceAllowance[] {
	const granted = readWorkspaceAllowances(nodeConfig);
	const announced = readWorkspaceAllowances(workspaceConfig).find(
		(a) => a.workspaceId === workspaceId,
	);
	if (!announced) return granted;

	const grant = granted.find((a) => a.workspaceId === workspaceId);
	const outcome = reconcileAnnouncedAllowance(
		grant?.maxRequestsPerMonth,
		announced.maxRequestsPerMonth,
	);
	if (outcome.effective === undefined) return granted;
	return [
		...granted.filter((a) => a.workspaceId !== workspaceId),
		{ workspaceId, maxRequestsPerMonth: outcome.effective },
	];
}
