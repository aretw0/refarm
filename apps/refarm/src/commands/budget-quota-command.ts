/**
 * The wiring for `refarm budget quota`. Kept out of `budget.ts` because it reaches the PROVIDER —
 * the rest of that file reads only the local record, and mixing the two would make every budget
 * read look like it might go to the network.
 */
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";
import nodeFs from "node:fs";
import nodePath from "node:path";

import { SiloCore } from "@refarm.dev/silo";

import { readWorkspaceAllowances } from "@refarm.dev/budget-contract-v1";
import { readMeterUsageFacts } from "@refarm.dev/model-account-contract-v1";
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
	// Declared in the NODE config beside nodeTools, for the same reason: this is a fact about the
	// machine's relationship with a provider, not about any repository standing here.
	const config = readNodeConfig();
	const facts = readMeterUsageFacts(config);
	const report = reconcileQuotaRows(
		rows,
		page.observations,
		(options.now ?? Date.now)(),
		facts,
		readWorkspaceAllowances(config),
	);

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

/** The node-tier config, read without throwing: a quota report that dies on a config typo
 *  reports nothing, and reporting is its whole job. */
function readNodeConfig(): unknown {
	try {
		return JSON.parse(
			nodeFs.readFileSync(nodePath.join(resolveRefarmHome(), "config.json"), "utf-8"),
		);
	} catch {
		return {};
	}
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
			for (const share of row.workspaces) {
				const a = share.allowance;
				const standing =
					a.state === "within"
						? ` — ${a.remaining} of ${a.allowed} left`
						: a.state === "exceeded"
							? chalk.yellow(" — ALLOWANCE SPENT")
							: a.state === "cannot-check"
								? chalk.yellow(" — allowance unchecked")
								: "";
				console.log(chalk.dim(`    ${share.requests} of them for workspace ${share.id}`) + standing);
				if (a.state === "exceeded" || a.state === "cannot-check") {
					console.log(chalk.dim(`      ${a.because}`));
				}
			}
			const named = row.workspaces.reduce((sum, s) => sum + s.requests, 0);
			if (named < dispatched) {
				// Stated, never inferred by subtraction on the reader's part: a dispatch that named
				// no workspace spent the seat and said for whom it did not.
				console.log(
					chalk.dim(`    ${dispatched - named} named no workspace`),
				);
			}
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
