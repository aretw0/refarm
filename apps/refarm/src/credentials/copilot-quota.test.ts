import { describe, expect, it } from "vitest";

import {
	COPILOT_QUOTA_URL,
	githubUserTokenOf,
	outcomeForStatus,
	readCopilotQuota,
} from "./copilot-quota.js";

/** The stored shape, as it is on the operator's node: a short-lived copilot token in `access` and
 *  the GitHub user token in `refresh`. */
const STORED = {
	access: "tid=abc123;exp=1786808109;sku=copilot_for_business_seat_quota",
	refresh: "ghu_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
	accountId: "0c606c35a284b4b346de451cc9d5cf41",
	expires: 1786808109000,
};

const BODY = {
	copilot_plan: "business",
	access_type_sku: "copilot_for_business_seat_quota",
	quota_reset_date: "2026-09-01",
	quota_snapshots: {
		chat: { unlimited: true, has_quota: true, entitlement: 0, remaining: 0, percent_remaining: 100 },
		premium_interactions: {
			unlimited: false,
			has_quota: true,
			entitlement: 10000,
			remaining: 3004,
			percent_remaining: 30,
			overage_permitted: true,
			overage_count: 0,
		},
	},
};

const okFetch = (body: unknown = BODY) =>
	(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("githubUserTokenOf", () => {
	it("finds the ghu_ token and never the short-lived copilot one", () => {
		// ISS-129 measured the cost of getting this backwards: the stored `access` was presented to
		// api.github.com, GitHub answered 401, and the reading was "the provider refuses us" — twice.
		expect(githubUserTokenOf(STORED)).toBe(STORED.refresh);
	});

	it("is keyed on the PREFIX, not on the field name", () => {
		// The field is where this node happens to keep it; `ghu_` is what GitHub issues. Keyed on
		// the name, a moved field would read as "no token" on a perfectly good credential.
		expect(githubUserTokenOf({ somethingElse: "ghu_ZZZZ" })).toBe("ghu_ZZZZ");
	});

	it("returns nothing for a credential that carries no user token", () => {
		expect(githubUserTokenOf({ access: "tid=only" })).toBeUndefined();
		expect(githubUserTokenOf(null)).toBeUndefined();
	});
});

describe("outcomeForStatus", () => {
	it("separates a REJECTED credential from an UNAVAILABLE provider", () => {
		// The distinction is the point of the whole module: an expired token nobody renewed reads
		// exactly like an exhausted account unless these two are kept apart.
		expect(outcomeForStatus(401)).toEqual({ kind: "rejected", status: 401 });
		expect(outcomeForStatus(403)).toEqual({ kind: "rejected", status: 403 });
		expect(outcomeForStatus(503)).toEqual({ kind: "unavailable", status: 503 });
		expect(outcomeForStatus(502)).toEqual({ kind: "unavailable", status: 502 });
	});
});

describe("readCopilotQuota", () => {
	it("reads the meters when GitHub answers", async () => {
		const result = await readCopilotQuota(STORED, { fetch: okFetch() });
		expect(result).toMatchObject({ kind: "read" });
		if (result.kind !== "read") return;
		expect(result.quota.meters.premium_interactions).toMatchObject({
			kind: "metered",
			remaining: 3004,
			overagePermitted: true,
		});
		expect(result.quota.meters.chat).toEqual({ kind: "unlimited" });
	});

	it("presents the ghu_ token as a GitHub token, at the measured URL", async () => {
		let seen: { url: string; auth: string | null } | undefined;
		await readCopilotQuota(STORED, {
			fetch: (async (url: string, init: RequestInit) => {
				seen = { url: String(url), auth: new Headers(init.headers).get("authorization") };
				return new Response(JSON.stringify(BODY), { status: 200 });
			}) as unknown as typeof fetch,
		});
		expect(seen?.url).toBe(COPILOT_QUOTA_URL);
		expect(seen?.auth).toBe(`token ${STORED.refresh}`);
	});

	it("says CANNOT-ASK when no user token is stored, which is not a provider answer", async () => {
		const result = await readCopilotQuota({ access: "tid=only" }, { fetch: okFetch() });
		expect(result).toMatchObject({ kind: "cannot-ask" });
	});

	it("says UNREACHABLE when the request never completes", async () => {
		const result = await readCopilotQuota(STORED, {
			fetch: (async () => {
				throw new Error("getaddrinfo ENOTFOUND");
			}) as unknown as typeof fetch,
		});
		expect(result).toMatchObject({ kind: "unreachable" });
	});

	it("does NOT report an unparseable 200 as an empty quota", async () => {
		// An empty `meters` map reads as measured-and-nothing-metered. A body this build cannot
		// parse has measured nothing at all.
		const result = await readCopilotQuota(STORED, {
			fetch: (async () => new Response("<html>proxy</html>", { status: 200 })) as unknown as typeof fetch,
		});
		expect(result.kind).not.toBe("read");
	});
});

describe("retrying", () => {
	const noSleep = async () => {};

	it("asks again after a 5xx, because this endpoint answers 503 and then 200", async () => {
		// Measured repeatedly on 2026-08-17: the same credential got 503, then 200 seconds later.
		// Without this the command reported `unavailable` for a healthy account most of the time.
		let call = 0;
		const result = await readCopilotQuota(STORED, {
			sleep: noSleep,
			fetch: (async () => {
				call += 1;
				return call === 1
					? new Response("{}", { status: 503 })
					: new Response(JSON.stringify(BODY), { status: 200 });
			}) as unknown as typeof fetch,
		});
		expect(result.kind).toBe("read");
		expect(call).toBe(2);
	});

	it("does NOT retry a rejected credential", async () => {
		// Retrying an auth failure turns one clear answer into a slow ambiguous one, and the answer
		// would be identical every time.
		let call = 0;
		const result = await readCopilotQuota(STORED, {
			sleep: noSleep,
			fetch: (async () => {
				call += 1;
				return new Response("{}", { status: 401 });
			}) as unknown as typeof fetch,
		});
		expect(result).toMatchObject({ kind: "rejected" });
		expect(call).toBe(1);
	});

	it("gives up and reports UNAVAILABLE rather than pretending, when it stays down", async () => {
		let call = 0;
		const result = await readCopilotQuota(STORED, {
			sleep: noSleep,
			attempts: 3,
			fetch: (async () => {
				call += 1;
				return new Response("{}", { status: 502 });
			}) as unknown as typeof fetch,
		});
		expect(result).toMatchObject({ kind: "unavailable", status: 502 });
		expect(call).toBe(3);
	});
});
