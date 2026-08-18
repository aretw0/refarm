/**
 * WHAT AN ACCOUNT HAS LEFT — read from the provider, never declared by the operator.
 *
 * ISS-064's ruling: the denominator is an EXTRACTION, not a declaration. A hand-typed plan size
 * goes stale the day the plan changes and nothing notices. So this parses what a provider actually
 * answers and reports what it could not answer as its own state.
 *
 * ## Three states, and collapsing any two produces a wrong number
 *
 *  - `unlimited`   the provider meters this and declares no ceiling. There is no denominator, and
 *                  that is an ANSWER rather than a gap.
 *  - `metered`     an entitlement, a remainder, and a reset. The only state a percentage means
 *                  anything in.
 *  - `cannot-say`  asked, and the provider did not answer. NOT zero, NOT unlimited.
 *
 * ## The trap this vocabulary exists to not fall into, measured 2026-08-17
 *
 * GitHub Copilot answers, for both of the operator's accounts:
 *
 *     chat                  unlimited=true   entitlement=0   remaining=0    percent_remaining=100
 *     completions           unlimited=true   entitlement=0   remaining=0    percent_remaining=100
 *     premium_interactions  unlimited=false  entitlement=10000 remaining=3004  percent_remaining=30
 *
 * `remaining: 0` ON AN UNLIMITED METER. A reader that took `remaining` at face value would report
 * an account with no ceiling as fully exhausted, and would do it confidently, on real provider
 * data. `unlimited` is therefore read FIRST and `remaining` is never consulted underneath it.
 *
 * ## Exhausted is not blocked
 *
 * `overagePermitted` is carried because the two facts diverge: the operator's corporate seat
 * permits overage, so reaching zero there means billing continues, not that work stops. A node
 * that reported only "depleted" would send him looking for a failure that will not happen.
 *
 * VOCABULARY ONLY. The READERS that turn one provider's body into these states moved to that
 * provider's own block (`@refarm.dev/github-copilot-wire`, ISS-142): the three states and what they
 * mean are generic, and `quota_snapshots` / `has_quota` / `percent_remaining` are Copilot's field
 * names. Keeping the parsing here is how a generic contract accretes one vendor's shape.
 *
 * PURE. No fetch, no clock, no provider knowledge at all.
 */

export type QuotaMeter =
	| { readonly kind: "unlimited" }
	| {
			readonly kind: "metered";
			readonly entitlement: number;
			readonly remaining: number;
			readonly percentRemaining: number;
			readonly overagePermitted: boolean;
			readonly overageCount: number;
	  }
	| { readonly kind: "cannot-say"; readonly reason: string };

export interface AccountQuota {
	/** The provider's own name for the plan, when it gives one. Display only — never a selector. */
	readonly plan?: string;
	readonly sku?: string;
	/** ISO date the meters reset, when the provider states it. */
	readonly resetsAt?: string;
	/** Keyed by the provider's own meter id, because inventing names would lose which is which. */
	readonly meters: Readonly<Record<string, QuotaMeter>>;
}

/**
 * PURE. Whether a meter is out — and the answer is `undefined` when the node cannot tell.
 *
 * THREE-VALUED ON PURPOSE. `false` means measured and not out; `undefined` means unmeasured. A
 * boolean would make "we could not ask" indistinguishable from "there is plenty", which is the
 * shape that lets a node report health it never established.
 */
export function isMeterExhausted(meter: QuotaMeter): boolean | undefined {
	if (meter.kind === "unlimited") return false;
	if (meter.kind === "cannot-say") return undefined;
	return meter.remaining <= 0;
}

/** PURE. The meters that ARE metered, which is where a denominator can come from at all. */
export function meteredEntries(
	quota: AccountQuota,
): readonly (readonly [string, Extract<QuotaMeter, { kind: "metered" }>])[] {
	return Object.entries(quota.meters).flatMap(([id, meter]) =>
		meter.kind === "metered" ? [[id, meter] as const] : [],
	);
}
