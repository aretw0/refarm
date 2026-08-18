import { describe, expect, it } from "vitest";

import { readAccountQuota, readQuotaMeter } from "./quota.js";

/**
 * THE FIXTURES ARE RECORDED, not invented. Both bodies were measured on 2026-08-17 against
 * `GET https://api.github.com/copilot_internal/user` with the operator's two real Copilot accounts.
 * A fixture written from a doc would not have contained the trap in `unlimited` meters, because
 * nobody would think to write `remaining: 0` there.
 */
const CORPORATE = {
	login: "redacted",
	copilot_plan: "business",
	access_type_sku: "copilot_for_business_seat_quota",
	quota_reset_date: "2026-09-01",
	quota_snapshots: {
		chat: { unlimited: true, has_quota: true, entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100, overage_permitted: false, overage_count: 0 },
		completions: { unlimited: true, has_quota: true, entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100, overage_permitted: false, overage_count: 0 },
		premium_interactions: { unlimited: false, has_quota: true, entitlement: 10000, remaining: 3004, quota_remaining: 3004.1, percent_remaining: 30, overage_permitted: true, overage_count: 0 },
	},
};

const PERSONAL = {
	copilot_plan: "individual",
	access_type_sku: "monthly_subscriber_quota",
	quota_reset_date: "2026-09-01",
	quota_snapshots: {
		chat: { unlimited: true, has_quota: true, entitlement: 0, remaining: 0, percent_remaining: 100 },
		premium_interactions: { unlimited: false, has_quota: true, entitlement: 1500, remaining: 1500, percent_remaining: 100, overage_permitted: false, overage_count: 0 },
	},
};

describe("readQuotaMeter", () => {
	it("reads UNLIMITED before any number underneath it", () => {
		// The trap, and the only reason the ordering inside the function is load-bearing: this
		// provider sends `remaining: 0` and `entitlement: 0` on a meter with no ceiling. Reading
		// them first reports an unlimited account as fully exhausted, confidently, on real data.
		expect(readQuotaMeter(CORPORATE.quota_snapshots.chat)).toEqual({ kind: "unlimited" });
	});

	it("reads a metered snapshot with its entitlement, remainder and overage", () => {
		expect(readQuotaMeter(CORPORATE.quota_snapshots.premium_interactions)).toEqual({
			kind: "metered",
			entitlement: 10000,
			remaining: 3004,
			percentRemaining: 30,
			overagePermitted: true,
			overageCount: 0,
		});
	});

	it("says CANNOT-SAY when the provider states no entitlement, rather than calling it zero", () => {
		expect(readQuotaMeter({ percent_remaining: 100 })).toMatchObject({ kind: "cannot-say" });
	});

	it("treats an explicit has_quota:false as an answer, and its ABSENCE as nothing", () => {
		// Absent is not false. A snapshot that simply omits the flag has not said the meter does
		// not apply, and reading omission as denial would silently drop a real quota.
		expect(readQuotaMeter({ has_quota: false })).toMatchObject({ kind: "cannot-say" });
		expect(readQuotaMeter({ entitlement: 10, remaining: 4 })).toMatchObject({ kind: "metered" });
	});

	it("derives a percentage only when the provider gives none", () => {
		expect(readQuotaMeter({ entitlement: 200, remaining: 50 })).toMatchObject({
			percentRemaining: 25,
		});
		// And never divides by an entitlement of zero.
		expect(readQuotaMeter({ entitlement: 0, remaining: 0 })).toMatchObject({
			percentRemaining: 0,
		});
	});
});

describe("readAccountQuota", () => {
	it("reads the operator's corporate seat as measured", () => {
		const quota = readAccountQuota(CORPORATE);
		expect(quota.sku).toBe("copilot_for_business_seat_quota");
		expect(quota.resetsAt).toBe("2026-09-01");
		expect(quota.meters.chat).toEqual({ kind: "unlimited" });
		expect(quota.meters.premium_interactions).toMatchObject({ remaining: 3004 });
	});

	it("reads the operator's personal seat as measured", () => {
		const quota = readAccountQuota(PERSONAL);
		expect(quota.plan).toBe("individual");
		expect(quota.meters.premium_interactions).toMatchObject({
			entitlement: 1500,
			remaining: 1500,
			overagePermitted: false,
		});
	});

	it("returns NO meters when the body carries no snapshots, rather than inventing empty ones", () => {
		// This is the shape `copilot_internal/v2/token` returns — quota fields present and null —
		// which ISS-129 measured and read as "this provider cannot say". It was the wrong endpoint,
		// and the reading must stay honest for any provider where it is the right one.
		expect(readAccountQuota({ limited_user_quotas: null }).meters).toEqual({});
		expect(readAccountQuota(null).meters).toEqual({});
	});
});
