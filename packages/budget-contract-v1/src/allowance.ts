/**
 * WHAT A WORKSPACE MAY SPEND OF A SEAT, ACROSS A PERIOD.
 *
 * `resolveBudget` bounds ONE dispatch — its ceilings ride in that dispatch's payload. Measured
 * 2026-08-18, that is not what protects a shared subscription: a workspace can make five hundred
 * dispatches of one request each and never approach a per-run ceiling, which is how an operator's
 * seat went from 1706 premium interactions remaining to zero while every token cap on the node
 * stayed untouched.
 *
 * A subscription is metered per REQUEST across a PERIOD. So is this.
 *
 * WHAT IT CANNOT DO, and no wording here may imply otherwise: it does not reserve a share of the
 * provider's meter. Other clients — other editors, other machines, the operator's own browser —
 * spend the same seat, and this node cannot see or bound them. It bounds what THIS NODE
 * dispatches on one workspace's behalf, which is the only thing it is in a position to promise.
 */

export interface WorkspaceAllowance {
	readonly workspaceId: string;
	/**
	 * Requests this node may dispatch for the workspace inside one UTC CALENDAR MONTH.
	 *
	 * A month, named as a month, because that is what the enforcement counts. The provider states
	 * its own reset date and `budget quota` reports against THAT — for github-copilot the two
	 * coincide (it resets on the first). Calling this field "per period" while the code counted
	 * months would be the units error this whole surface exists to avoid, one layer up.
	 */
	readonly maxRequestsPerMonth: number;
}

export type AllowanceVerdict =
	/** Nobody declared a limit for this workspace. */
	| { readonly state: "unbounded" }
	| {
			readonly state: "within";
			readonly spent: number;
			readonly allowed: number;
			readonly remaining: number;
	  }
	| {
			readonly state: "exceeded";
			readonly spent: number;
			readonly allowed: number;
			readonly because: string;
	  }
	/**
	 * The spend could not be counted.
	 *
	 * PERMITS, and says so. Refusing work because the record was unreadable would make the node
	 * unusable whenever its runtime is down; permitting in silence would make the allowance a
	 * fiction. Permitting out loud is the only option that is neither.
	 */
	| { readonly state: "cannot-check"; readonly permits: true; readonly because: string };

/**
 * PURE. Reads declared per-period allowances.
 *
 * A malformed limit is DROPPED, never coerced. Read as `0` it would silently stop all work for
 * that workspace, which is the opposite of what a typo should cost — while a declared `0` is kept,
 * because an operator writing zero is refusing deliberately.
 */
export function readWorkspaceAllowances(config: unknown): WorkspaceAllowance[] {
	const declared =
		config && typeof config === "object"
			? (config as Record<string, unknown>).workspaceAllowances
			: undefined;
	if (!declared || typeof declared !== "object" || Array.isArray(declared)) return [];

	const allowances: WorkspaceAllowance[] = [];
	for (const [workspaceId, entry] of Object.entries(declared as Record<string, unknown>)) {
		if (!workspaceId.trim() || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const limit = (entry as Record<string, unknown>).maxRequestsPerMonth;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) continue;
		allowances.push({ workspaceId: workspaceId.trim(), maxRequestsPerMonth: limit });
	}
	return allowances;
}

/**
 * PURE. May this node dispatch for this workspace right now?
 *
 * `spent` is what the node's own record says the workspace already dispatched inside the period,
 * or `null` when it could not be counted.
 */
export function checkWorkspaceAllowance(
	workspaceId: string,
	spent: number | null,
	allowances: readonly WorkspaceAllowance[],
): AllowanceVerdict {
	const allowance = allowances.find((a) => a.workspaceId === workspaceId);
	if (!allowance) return { state: "unbounded" };

	if (spent === null) {
		return {
			state: "cannot-check",
			permits: true,
			because:
				`the allowance of ${allowance.maxRequestsPerMonth} request(s) for "${workspaceId}" could ` +
				"not be checked: this node could not count what it has already dispatched this month. " +
				"The dispatch is permitted and this is said out loud rather than passing as compliance.",
		};
	}

	const allowed = allowance.maxRequestsPerMonth;
	if (spent >= allowed) {
		return {
			state: "exceeded",
			spent,
			allowed,
			because:
				`this node has dispatched ${spent} of the ${allowed} request(s) allowed for "${workspaceId}" ` +
				"this month. Raise the allowance, wait for the month to turn, or bind the workspace " +
				"to another account. This bounds what THIS NODE sends — other clients spend the same seat.",
		};
	}
	return { state: "within", spent, allowed, remaining: allowed - spent };
}
