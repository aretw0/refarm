/**
 * The wiring for `refarm budget quota`. Kept out of `budget.ts` because it reaches the PROVIDER —
 * the rest of that file reads only the local record, and mixing the two would make every budget
 * read look like it might go to the network.
 */
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";

import { SiloCore } from "@refarm.dev/silo";

import {
	loadAccountCredentials,
	loadAccountView,
	type AccountViewSilo,
} from "../credentials/account-view-loader.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { reconcileQuotaRows, type QuotaReconciliationReport } from "./budget-quota.js";
import type { BudgetObservationsPage } from "./budget.js";
import { readQuotaRows } from "./credential-quota.js";
import { reportSidecarError } from "./sidecar-error.js";

export interface BudgetQuotaOptions {
	readonly limit: number;
	readonly json?: boolean;
	readonly fetchObservations: (limit: number, offset?: number) => Promise<BudgetObservationsPage>;
	readonly now?: () => number;
}

export async function runBudgetQuota(options: BudgetQuotaOptions): Promise<void> {
	// GUARDED, because this command reaches TWO networks. `readQuotaRows` already turns a provider
	// failure into a per-account outcome — that half degrades into a row that says so. The local
	// record does not: an unreachable runtime threw straight out of `parseAsync`, which the CLI
	// refusal guard caught. A command that crashes where a sibling refuses is a command an
	// operator cannot tell apart from a broken node.
	try {
		await runBudgetQuotaUnguarded(options);
	} catch (error) {
		reportSidecarError(error, {
			...(options.json ? { json: true } : {}),
			command: "budget",
			operation: "quota",
		});
	}
}

async function runBudgetQuotaUnguarded(options: BudgetQuotaOptions): Promise<void> {
	// ONE view per invocation, from the loader that owns the I/O — the same discipline
	// `credential quota` follows, so the two surfaces cannot assemble different pictures.
	const home = resolveRefarmHome();
	const silo = new SiloCore() as unknown as AccountViewSilo;
	const accounts = [...(await loadAccountView({ home, silo })).accounts];
	const credentials = await loadAccountCredentials({ home, silo });
	const rows = await readQuotaRows(accounts, credentials, { fetch: globalThis.fetch });
	const page = await options.fetchObservations(options.limit);
	const report = reconcileQuotaRows(rows, page.observations, (options.now ?? Date.now)());

	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "budget",
				operation: "quota",
				extra: { ...report, completeness: page.truncated === true ? "partial" : "complete" },
				nextAction: null,
				nextCommands: [],
			}),
		);
		return;
	}
	printQuotaHuman(report);
}

function printQuotaHuman(report: QuotaReconciliationReport): void {
	if (report.rows.length === 0) {
		console.log(chalk.dim("No model accounts are held on this node."));
		return;
	}
	for (const row of report.rows) {
		const window = row.window ? ` — ${row.window.label} (${row.window.source})` : "";
		console.log(chalk.bold(`${row.alias} · ${row.provider}${window}`));
		// ONCE, at the account, because that is what it is a fact about.
		const dispatched = row.meters[0]?.dispatchedHere;
		if (dispatched !== undefined && dispatched !== null) {
			console.log(chalk.dim(`  this node dispatched ${dispatched} request(s) in that period`));
		}
		for (const note of row.notes) console.log(`  ${note}`);
		console.log();
	}
	if (report.unattributed > 0) {
		console.log(
			chalk.dim(
				`${report.unattributed} dispatch(es) in this period named no account — counted against nobody's quota.`,
			),
		);
	}
	if (report.undated > 0) {
		console.log(
			chalk.dim(`${report.undated} dispatch(es) carry no timestamp, so no period can claim them.`),
		);
	}
}
