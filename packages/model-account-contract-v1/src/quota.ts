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
 * ## The trap this file exists to not fall into, measured 2026-08-17
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
 * PURE. Takes a parsed body, returns a reading. No fetch, no clock, no provider knowledge beyond
 * the shape it is handed.
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

const num = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/** PURE. One meter from one snapshot, with `unlimited` outranking every number beneath it. */
export function readQuotaMeter(snapshot: unknown): QuotaMeter {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return { kind: "cannot-say", reason: "the provider returned no snapshot for this meter" };
	}
	const s = snapshot as Record<string, unknown>;

	// FIRST, and the ordering is the whole point. On an unlimited meter this provider sends
	// `remaining: 0` and `entitlement: 0`; reading those before this flag reports no-ceiling as
	// exhausted.
	if (s.unlimited === true) return { kind: "unlimited" };

	// `has_quota: false` is the provider saying this meter does not apply to this plan. Absent is
	// not the same as false, so only an explicit false is treated as an answer.
	if (s.has_quota === false) {
		return { kind: "cannot-say", reason: "the provider does not meter this on this plan" };
	}

	const entitlement = num(s.entitlement);
	const remaining = num(s.remaining) ?? num(s.quota_remaining);
	if (entitlement === undefined || remaining === undefined) {
		return { kind: "cannot-say", reason: "the provider stated no entitlement or remainder" };
	}
	return {
		kind: "metered",
		entitlement,
		remaining,
		// Taken from the provider when it states one — its rounding is the one the operator sees in
		// GitHub's own UI, and recomputing would disagree with it by a fraction for no gain.
		percentRemaining:
			num(s.percent_remaining) ?? (entitlement > 0 ? (remaining / entitlement) * 100 : 0),
		overagePermitted: s.overage_permitted === true,
		overageCount: num(s.overage_count) ?? 0,
	};
}

/** PURE. A whole account's reading from a `copilot_internal/user`-shaped body. */
export function readAccountQuota(body: unknown): AccountQuota {
	if (!body || typeof body !== "object" || Array.isArray(body)) return { meters: {} };
	const b = body as Record<string, unknown>;
	const snapshots = b.quota_snapshots;
	const meters: Record<string, QuotaMeter> = {};
	if (snapshots && typeof snapshots === "object" && !Array.isArray(snapshots)) {
		for (const [id, snapshot] of Object.entries(snapshots as Record<string, unknown>)) {
			meters[id] = readQuotaMeter(snapshot);
		}
	}
	return {
		...(str(b.copilot_plan) ? { plan: str(b.copilot_plan)! } : {}),
		...(str(b.access_type_sku) ? { sku: str(b.access_type_sku)! } : {}),
		...(str(b.quota_reset_date) ? { resetsAt: str(b.quota_reset_date)! } : {}),
		meters,
	};
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
