import { describe, expect, it } from "vitest";

import {
	describeReconciliation,
	reconcileAccountQuota,
	type DispatchedOnAccount,
} from "./quota-reconciliation.js";
import type { AccountQuota } from "./quota.js";

const QUOTA: AccountQuota = {
	plan: "individual",
	sku: "monthly_subscriber_quota",
	resetsAt: "2026-09-01",
	meters: {
		chat: { kind: "unlimited" },
		premium_interactions: {
			kind: "metered",
			entitlement: 1500,
			remaining: 1200,
			percentRemaining: 80,
			overagePermitted: false,
			overageCount: 0,
		},
	},
};

const DISPATCHED = (over: Partial<DispatchedOnAccount> = {}): DispatchedOnAccount => ({
	credentialId: "model-account:AAAA",
	requests: 12,
	windowStart: "2026-08-01",
	...over,
});

describe("reconcileAccountQuota", () => {
	it("reports a metered meter's consumption WITHOUT claiming refarm caused it", () => {
		// The whole point. `consumed` is the provider's arithmetic (entitlement − remaining);
		// `dispatchedHere` is this node's own count. Subtracting one from the other would assert
		// that every dispatch consumed THIS meter, which nothing here knows.
		const [, premium] = reconcileAccountQuota(QUOTA, DISPATCHED());
		expect(premium).toMatchObject({
			kind: "metered",
			meter: "premium_interactions",
			entitlement: 1500,
			remaining: 1200,
			consumed: 300,
			dispatchedHere: 12,
			attribution: "unknown",
		});
	});

	it("NEVER emits a not-dispatched number", () => {
		// The ruling asked for `not dispatched` as a first-class figure. It cannot be computed from
		// what the provider publishes: the meter counts premium interactions and the record counts
		// requests without recording WHICH meter each consumed. A number here would be invented.
		const json = JSON.stringify(reconcileAccountQuota(QUOTA, DISPATCHED()));
		expect(json).not.toMatch(/notDispatched|not_dispatched/u);
	});

	it("says UNLIMITED rather than pretending a limit it was never given", () => {
		const [chat] = reconcileAccountQuota(QUOTA, DISPATCHED());
		expect(chat).toEqual({ kind: "unlimited", meter: "chat", dispatchedHere: 12 });
	});

	it("carries a meter the provider refused to describe as cannot-say, not as zero", () => {
		const quota: AccountQuota = {
			meters: { seats: { kind: "cannot-say", reason: "not exposed to this token" } },
		};
		expect(reconcileAccountQuota(quota, DISPATCHED())).toEqual([
			{
				kind: "cannot-say",
				meter: "seats",
				reason: "not exposed to this token",
				dispatchedHere: 12,
			},
		]);
	});

	it("refuses to count dispatches against a window it was not told the start of", () => {
		// A monthly meter compared against all-time dispatches is the same category error as
		// comparing tokens to requests, moved into the time dimension. Absent a declared window,
		// the node's own count is UNKNOWN rather than "everything ever".
		const [, premium] = reconcileAccountQuota(QUOTA, DISPATCHED({ windowStart: undefined }));
		expect(premium).toMatchObject({ dispatchedHere: null });
	});

	it("is stable in meter order, so two reads can be diffed", () => {
		const once = reconcileAccountQuota(QUOTA, DISPATCHED()).map((m) => m.meter);
		const again = reconcileAccountQuota(QUOTA, DISPATCHED()).map((m) => m.meter);
		expect(once).toEqual(again);
		expect(once).toEqual(["chat", "premium_interactions"]);
	});
});

describe("describeReconciliation", () => {
	it("states the gap as UNATTRIBUTED, never as refarm's spend", () => {
		const [, premium] = reconcileAccountQuota(QUOTA, DISPATCHED());
		const text = describeReconciliation(premium!);
		expect(text).toContain("300");
		expect(text).toContain("12");
		expect(text).toMatch(/cannot say|unattributed|not known/iu);
	});

	it("says nothing misleading about an unlimited meter", () => {
		const [chat] = reconcileAccountQuota(QUOTA, DISPATCHED());
		expect(describeReconciliation(chat!)).toMatch(/unlimited/iu);
	});

	it("does NOT repeat the account's dispatch count on every meter", () => {
		// It is an account fact. Printed once per meter, three meters read as three times the
		// traffic — and a reader who adds them gets a number nothing measured.
		const [chat] = reconcileAccountQuota(QUOTA, DISPATCHED());
		expect(describeReconciliation(chat!)).not.toMatch(/\b12\b/u);
	});

	it("names no CLI verb, so any surface can render it", () => {
		const [, premium] = reconcileAccountQuota(QUOTA, DISPATCHED());
		expect(describeReconciliation(premium!)).not.toMatch(/refarm /u);
	});
});
