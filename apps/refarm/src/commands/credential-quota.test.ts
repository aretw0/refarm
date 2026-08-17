import { describe, expect, it } from "vitest";

import type { ModelAccountDescriptor } from "@refarm.dev/model-account-contract-v1";

import {
	exhaustedMeters,
	formatQuotaRows,
	quotaRow,
	readQuotaRows,
	type AccountQuotaRow,
} from "./credential-quota.js";

const account = (
	provider: string,
	alias: string,
	overrides: Partial<ModelAccountDescriptor> = {},
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider,
	alias,
	identity: { status: "verified", subject: alias },
	secretRef: `model/${alias}`,
	health: "healthy",
	revision: "sha256:r",
	...overrides,
});

const CORPORATE_BODY = {
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

const okFetch = (async () =>
	new Response(JSON.stringify(CORPORATE_BODY), { status: 200 })) as unknown as typeof fetch;

describe("readQuotaRows", () => {
	it("says it DID NOT ASK for a provider it has no reader for", async () => {
		// The alternative — omitting the account — would let "we never asked" pass for "there is
		// nothing to report", which is the answer the operator most needs to be able to distrust.
		const rows = await readQuotaRows(
			[account("openai-codex", "account-2")],
			new Map([["model-account:ACCOUNT-2XXXXXXXXXXXXXXXXX", { refresh: "ghu_x" }]]),
			{ fetch: okFetch },
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ outcome: "cannot-ask" });
		expect(rows[0]!.detail).toMatch(/no quota reader for openai-codex/u);
	});

	it("reads a Copilot account through its own credential", async () => {
		const corp = account("github-copilot", "corporativo");
		const rows = await readQuotaRows([corp], new Map([[corp.credentialId, { refresh: "ghu_x" }]]), {
			fetch: okFetch,
		});
		expect(rows[0]).toMatchObject({ outcome: "read", alias: "corporativo" });
		expect(rows[0]!.quota?.meters.premium_interactions).toMatchObject({ remaining: 3004 });
	});

	it("says CANNOT-ASK when this node holds no readable secret for the account", async () => {
		const corp = account("github-copilot", "corporativo");
		const rows = await readQuotaRows([corp], new Map(), { fetch: okFetch });
		expect(rows[0]).toMatchObject({ outcome: "cannot-ask" });
	});

	it("asks EVERY account of one provider separately, never one for the pair", async () => {
		// The whole point of a per-account denominator. A reader keyed on provider would answer once
		// and attribute the same number to two accounts with different plans.
		const seen: string[] = [];
		const corp = account("github-copilot", "corporativo");
		const personal = account("github-copilot", "pessoal");
		await readQuotaRows(
			[corp, personal],
			new Map([
				[corp.credentialId, { refresh: "ghu_corp" }],
				[personal.credentialId, { refresh: "ghu_personal" }],
			]),
			{
				fetch: (async (_url: string, init: RequestInit) => {
					seen.push(String(new Headers(init.headers).get("authorization")));
					return new Response(JSON.stringify(CORPORATE_BODY), { status: 200 });
				}) as unknown as typeof fetch,
			},
		);
		expect(seen).toEqual(["token ghu_corp", "token ghu_personal"]);
	});
});

describe("quotaRow", () => {
	it("separates a REJECTED credential from a quota that ran out, in words", async () => {
		const row = quotaRow(account("github-copilot", "corporativo"), { kind: "rejected", status: 401 });
		expect(row.outcome).toBe("rejected");
		expect(row.detail).toMatch(/credential to repair, not a quota that ran out/u);
	});

	it("says an UNAVAILABLE provider tells us nothing about quota", () => {
		const row = quotaRow(account("github-copilot", "pessoal"), { kind: "unavailable", status: 503 });
		expect(row.detail).toMatch(/says nothing about quota/u);
	});
});

describe("formatQuotaRows", () => {
	it("prints unlimited as unlimited, never as zero remaining", async () => {
		const corp = account("github-copilot", "corporativo");
		const rows = await readQuotaRows([corp], new Map([[corp.credentialId, { refresh: "ghu_x" }]]), {
			fetch: okFetch,
		});
		const text = formatQuotaRows(rows);
		expect(text).toMatch(/chat\s+unlimited/u);
		expect(text).toMatch(/3004 \/ 10000/u);
		expect(text).toMatch(/overage permitted/u);
		expect(text).toMatch(/resets 2026-09-01/u);
	});

	it("sends a node with no accounts to sow rather than printing an empty table", () => {
		expect(formatQuotaRows([])).toMatch(/refarm sow/u);
	});
});

describe("exhaustedMeters", () => {
	it("counts only what was MEASURED, so an unasked account is not a quiet all-clear", () => {
		const rows: AccountQuotaRow[] = [
			{
				credentialId: "a",
				provider: "github-copilot",
				alias: "corporativo",
				outcome: "read",
				quota: {
					meters: {
						chat: { kind: "unlimited" },
						premium_interactions: {
							kind: "metered",
							entitlement: 10,
							remaining: 0,
							percentRemaining: 0,
							overagePermitted: true,
							overageCount: 2,
						},
					},
				},
			},
			{ credentialId: "b", provider: "openai-codex", alias: "account-2", outcome: "cannot-ask" },
		];
		expect(exhaustedMeters(rows)).toEqual([
			{ alias: "corporativo", meter: "premium_interactions" },
		]);
	});
});
