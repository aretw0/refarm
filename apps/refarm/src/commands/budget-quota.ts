/**
 * `refarm budget quota` — the provider's remainder beside this node's dispatches.
 *
 * ISS-073 step 1. The contract that decides what the pairing MEANS lives in
 * @refarm.dev/model-account-contract-v1 (`reconcileAccountQuota`, `quotaWindowFor`); this file
 * only composes it with the two readers that already exist — `readQuotaRows` for the provider
 * side, the BudgetObservation record for this node's side.
 *
 * It emits no total. The two counts are in different units and the attribution between them is
 * unknown, which the contract states in every row rather than leaving a reader to subtract.
 */
import {
	describeReconciliation,
	quotaWindowFor,
	reconcileAccountQuota,
	type MeterReconciliation,
	type QuotaWindow,
} from "@refarm.dev/model-account-contract-v1";

import { dispatchedPerAccount, parsePeriodSpec, type ObservationNode } from "./budget.js";
import type { AccountQuotaRow } from "./credential-quota.js";

export interface QuotaReconciliationRow {
	readonly credentialId: string;
	readonly alias: string;
	readonly provider: string;
	/** How the provider answered — `read` is the only outcome that carries meters. */
	readonly outcome: AccountQuotaRow["outcome"];
	readonly detail?: string;
	/** `null` when no window could be established, which makes every count in this row unplaceable
	 *  rather than wrong. */
	readonly window: (QuotaWindow & { readonly label: string }) | null;
	readonly meters: readonly MeterReconciliation[];
	/** The prose a surface renders, one line per meter. */
	readonly notes: readonly string[];
}

export interface QuotaReconciliationReport {
	readonly rows: readonly QuotaReconciliationRow[];
	/** Dated dispatches inside SOME window that named no account. Never folded into a row. */
	readonly unattributed: number;
	/** Dispatches carrying no timestamp, which no window can claim. */
	readonly undated: number;
}

/**
 * PURE. Pair each account's provider meters with what this node dispatched in the same period.
 *
 * `nowMs` is injected rather than read, so a test pins the calendar instead of inheriting the
 * moment it happens to run — the same reason `parsePeriodSpec` takes it.
 */
export function reconcileQuotaRows(
	rows: readonly AccountQuotaRow[],
	observations: readonly ObservationNode[],
	nowMs: number,
): QuotaReconciliationReport {
	let unattributed = 0;
	let undated = 0;

	const reconciled = rows.map((row): QuotaReconciliationRow => {
		const window = row.quota ? quotaWindowFor(row.quota.resetsAt) : null;
		if (!row.quota || !window) {
			return {
				credentialId: row.credentialId,
				alias: row.alias,
				provider: row.provider,
				outcome: row.outcome,
				...(row.detail !== undefined ? { detail: row.detail } : {}),
				window: null,
				meters: [],
				notes: [noWindowNote(row)],
			};
		}

		const period = parsePeriodSpec(window.spec, nowMs);
		const counted = dispatchedPerAccount(observations, period);
		// Counted once, from the first row that establishes a window: these buckets are about the
		// RECORD, not about an account, and adding them up per row would multiply them.
		unattributed = Math.max(unattributed, counted.unattributed);
		undated = Math.max(undated, counted.undated);

		const meters = reconcileAccountQuota(row.quota, {
			credentialId: row.credentialId,
			requests: counted.byAccount.get(row.credentialId) ?? 0,
			windowStart: window.spec,
		});

		return {
			credentialId: row.credentialId,
			alias: row.alias,
			provider: row.provider,
			outcome: row.outcome,
			...(row.detail !== undefined ? { detail: row.detail } : {}),
			window: { ...window, label: period.label },
			meters,
			notes: meters.map(describeReconciliation),
		};
	});

	return { rows: reconciled, unattributed, undated };
}

/** PURE. Why a row carries no comparison — three different reasons, and an operator repairs each
 *  differently, so they must not collapse into "no data". */
function noWindowNote(row: AccountQuotaRow): string {
	if (row.outcome !== "read") {
		return `${row.alias}: the provider did not answer (${row.outcome}${row.detail ? `: ${row.detail}` : ""}), so there is no remainder to compare against — which is not the same as having none left.`;
	}
	return (
		`${row.alias}: the provider answered but stated no reset date this build can turn into a ` +
		"period, so this node's own dispatch count cannot be placed against its meters. The meters " +
		"below are still the provider's own figures."
	);
}
