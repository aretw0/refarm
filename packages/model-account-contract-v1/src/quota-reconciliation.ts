/**
 * PUTTING THE PROVIDER'S NUMBER BESIDE THIS NODE'S, WITHOUT FUSING THEM.
 *
 * ISS-073, operator ruling 2026-08-12: the spend record should cover work this node did not
 * dispatch, and it must SEPARATE the two — because a record that counts only its own dispatches
 * answers "is this tool expensive" instead of "how much of my quota is left".
 *
 * The ruling imagined three figures: dispatched, not-dispatched, unknown. Measured against a real
 * provider on 2026-08-18, the middle one CANNOT BE COMPUTED, and the reason matters more than the
 * gap:
 *
 *   - the provider meters PREMIUM INTERACTIONS; the budget record counts TOKENS and REQUESTS;
 *   - its meters reset on a date, so an all-time dispatch count is the same category error moved
 *     into the time dimension;
 *   - and not every dispatch consumes a metered meter — the model measured that day landed on an
 *     `unlimited` one — while nothing records WHICH meter a dispatch consumed.
 *
 * So `not dispatched = consumed − dispatched` would assert an attribution no one measured. This
 * module refuses to emit it. What it emits instead is both numbers, side by side, with the
 * attribution between them named as `unknown` — which is the ruling's own third state, applied to
 * the question the ruling did not know it was asking.
 *
 * Recording the meter a dispatch consumed is what would turn `unknown` into a number. That is a
 * change to the dispatch path, not to this reader, and it is tracked separately.
 */
import type { AccountQuota, QuotaMeter } from "./quota.js";

export interface DispatchedOnAccount {
	readonly credentialId: string;
	/** Requests this node dispatched on the account, counted inside `windowStart`. */
	readonly requests: number;
	/**
	 * The start of the window the count covers, as the caller declared it.
	 *
	 * REQUIRED for the count to mean anything against a resetting meter. Absent, `dispatchedHere`
	 * comes back `null` rather than a number that silently spans a different period than the
	 * provider's.
	 */
	readonly windowStart?: string;
}

interface ReconciliationBase {
	readonly meter: string;
	/** This node's own dispatch count for the window — `null` when no window was declared. */
	readonly dispatchedHere: number | null;
}

export type MeterReconciliation =
	| (ReconciliationBase & { readonly kind: "unlimited" })
	| (ReconciliationBase & { readonly kind: "cannot-say"; readonly reason: string })
	| (ReconciliationBase & {
			readonly kind: "metered";
			readonly entitlement: number;
			readonly remaining: number;
			/** The PROVIDER's arithmetic, not ours. */
			readonly consumed: number;
			/**
			 * How much of `consumed` this node caused. Always `unknown` today, and stated rather
			 * than omitted: a reader that sees two numbers and no attribution will subtract them.
			 */
			readonly attribution: "unknown";
	  });

/** PURE. Every meter the provider published, in a stable order, each beside this node's count. */
export function reconcileAccountQuota(
	quota: AccountQuota,
	dispatched: DispatchedOnAccount,
): MeterReconciliation[] {
	const dispatchedHere = dispatched.windowStart ? dispatched.requests : null;
	return Object.keys(quota.meters)
		.sort()
		.map((meter) => reconcileMeter(meter, quota.meters[meter]!, dispatchedHere));
}

function reconcileMeter(
	meter: string,
	value: QuotaMeter,
	dispatchedHere: number | null,
): MeterReconciliation {
	if (value.kind === "unlimited") return { kind: "unlimited", meter, dispatchedHere };
	if (value.kind === "cannot-say") {
		return { kind: "cannot-say", meter, reason: value.reason, dispatchedHere };
	}
	return {
		kind: "metered",
		meter,
		entitlement: value.entitlement,
		remaining: value.remaining,
		// Derived from the provider's own two numbers, so it cannot disagree with them.
		consumed: value.entitlement - value.remaining,
		dispatchedHere,
		attribution: "unknown",
	};
}

/** PURE. The fact, in the operator's terms. Never names a CLI verb — the handoff is rendered
 *  where every other one is. */
export function describeReconciliation(reconciliation: MeterReconciliation): string {
	const here =
		reconciliation.dispatchedHere === null
			? "this node's own count is unknown for that period"
			: `this node dispatched ${reconciliation.dispatchedHere} request(s)`;

	// The dispatch count is an ACCOUNT fact, not a per-meter one. Repeating it on every line
	// invites a reader to add it up — three meters would read as three times the traffic. It
	// appears only where it is part of a comparison.
	if (reconciliation.kind === "unlimited") {
		return `\`${reconciliation.meter}\` is unlimited on this plan, so there is no remainder to spend down.`;
	}
	if (reconciliation.kind === "cannot-say") {
		return `\`${reconciliation.meter}\`: the provider would not say (${reconciliation.reason}), which is not zero.`;
	}
	return (
		`\`${reconciliation.meter}\`: ${reconciliation.consumed} of ${reconciliation.entitlement} consumed, ` +
		`${reconciliation.remaining} left. In the same period ${here}. How much of that consumption ` +
		"this node caused is UNATTRIBUTED: nothing records which meter a dispatch spends, so the two " +
		"numbers must not be subtracted."
	);
}
