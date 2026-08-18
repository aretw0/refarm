/**
 * READING COPILOT'S QUOTA BODY into the generic meter vocabulary.
 *
 * `quota_snapshots`, `has_quota`, `percent_remaining`, `access_type_sku` are GitHub Copilot's field
 * names. The three states they are read into — unlimited / metered / cannot-say — are not, and live
 * in `@refarm.dev/model-account-contract-v1` where any provider can reach them (ISS-142).
 *
 * ## The trap, measured 2026-08-17 on two real seats
 *
 *     chat                  unlimited=true   entitlement=0     remaining=0    percent_remaining=100
 *     completions           unlimited=true   entitlement=0     remaining=0    percent_remaining=100
 *     premium_interactions  unlimited=false  entitlement=10000 remaining=3004 percent_remaining=30
 *
 * `remaining: 0` ON AN UNLIMITED METER. A reader taking `remaining` at face value would report an
 * account with no ceiling as fully exhausted — confidently, on real provider data. `unlimited` is
 * read FIRST and `remaining` is never consulted underneath it.
 *
 * PURE. Takes a parsed body, returns a reading.
 */
import type { AccountQuota, QuotaMeter } from "@refarm.dev/model-account-contract-v1";

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
