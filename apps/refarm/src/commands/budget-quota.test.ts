import { describe, expect, it } from "vitest";

import { reconcileQuotaRows } from "./budget-quota.js";
import type { AccountQuotaRow } from "./credential-quota.js";

/**
 * ISS-073 step 1+2. What this defends is that the two sides stay SEPARATE while sharing a period:
 * the provider's remainder, this node's count, and nothing derived from putting them together.
 */
const NOW = Date.UTC(2026, 7, 20);

const readRow = (over: Partial<AccountQuotaRow> = {}): AccountQuotaRow => ({
	credentialId: "model-account:AAAA",
	alias: "pessoal",
	provider: "github-copilot",
	outcome: "read",
	quota: {
		plan: "individual",
		resetsAt: "2026-09-01",
		meters: {
			premium_interactions: {
				kind: "metered",
				entitlement: 1500,
				remaining: 1200,
				percentRemaining: 80,
				overagePermitted: false,
				overageCount: 0,
			},
		},
	},
	...over,
});

const obs = (ms: number, account: string | null) => ({
	timestamp_ns: ms * 1_000_000,
	...(account ? { "refarm.budget.credentialId": account } : {}),
});

describe("reconcileQuotaRows", () => {
	it("counts only the dispatches inside the provider's own period", () => {
		const report = reconcileQuotaRows(
			[readRow()],
			[
				obs(Date.UTC(2026, 7, 3), "model-account:AAAA"),
				obs(Date.UTC(2026, 7, 18), "model-account:AAAA"),
				obs(Date.UTC(2026, 6, 28), "model-account:AAAA"), // July — the meter already reset
			],
			NOW,
		);
		expect(report.rows[0]?.window).toMatchObject({ spec: "2026-08", source: "derived-from-reset" });
		expect(report.rows[0]?.meters[0]).toMatchObject({ dispatchedHere: 2, consumed: 300 });
	});

	it("never derives a spend figure from the two numbers", () => {
		const report = reconcileQuotaRows([readRow()], [obs(Date.UTC(2026, 7, 3), "model-account:AAAA")], NOW);
		expect(JSON.stringify(report)).not.toMatch(/notDispatched|not_dispatched/u);
		// UNKNOWN, not `none`: these fixtures carry no model fields, so the account sent traffic
		// nobody can classify. Claiming the meter went untouched there would be the bug this
		// assertion exists to hold shut.
		const meter = report.rows[0]?.meters[0];
		expect(meter?.kind).toBe("metered");
		expect(meter?.kind === "metered" && meter.attribution).toMatchObject({ kind: "unknown" });
	});

	it("keeps a provider that could not be asked as its own outcome, not as zero remaining", () => {
		// `cannot-ask` and "nothing left" are opposite facts and the operator repairs them
		// differently. Rendering both as an absent meter would merge them.
		const report = reconcileQuotaRows(
			[{ credentialId: "b", alias: "account-2", provider: "openai-codex", outcome: "cannot-ask" }],
			[],
			NOW,
		);
		expect(report.rows[0]?.meters).toEqual([]);
		expect(report.rows[0]?.window).toBeNull();
		expect(report.rows[0]?.notes[0]).toMatch(/not the same as having none left/u);
	});

	it("still shows the provider's meters when the reset date yields no period", () => {
		// Losing the comparison must not lose the provider's own figures — they are the half this
		// node could not have known on its own.
		const row = readRow({ quota: { resetsAt: "2026-09-17", meters: readRow().quota!.meters } });
		const report = reconcileQuotaRows([row], [], NOW);
		expect(report.rows[0]?.window).toBeNull();
		expect(report.rows[0]?.notes[0]).toMatch(/still the provider's own figures/u);
	});

	it("reports record-level absences ONCE, not once per account", () => {
		// `unattributed` and `undated` describe the RECORD. Summing them across rows would multiply
		// one fact by however many accounts happen to be declared.
		const report = reconcileQuotaRows(
			[readRow(), readRow({ credentialId: "model-account:BBBB", alias: "corporativo" })],
			[obs(Date.UTC(2026, 7, 4), null), { "refarm.budget.credentialId": "model-account:AAAA" }],
			NOW,
		);
		expect(report.unattributed).toBe(1);
		expect(report.undated).toBe(1);
	});

	it("gives an account with no dispatches a zero, not a null, once a window exists", () => {
		// Zero here is MEASURED: the window is known and nothing was found in it. That is a
		// different statement from "no window, so unplaceable", which is what null means.
		const report = reconcileQuotaRows([readRow()], [], NOW);
		expect(report.rows[0]?.meters[0]).toMatchObject({ dispatchedHere: 0 });
	});
});
