import {
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { fetchSidecarJson } from "@refarm.dev/sidecar-client";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { refarmCommand } from "../brand.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

/**
 * `refarm budget observations` — read back the `BudgetObservation` record Task 10
 * writes for every terminal effort: which ceiling governed the run, which axis
 * bound it, and what the run actually spent. The operator is this record's FIRST
 * consumer, and this command is the check that the join (budget resolution ⋈
 * usage ⋈ outcome, all flattened onto one node under OTel names) actually
 * joins — against the real graph, not a fixture.
 *
 * READS ONLY. Nothing here writes a node, retries an effort, or declares a
 * budget — `refarm dispatch` still has no `--budget-*` flag (a gap this task's
 * brief surfaced; a later task owns it), so this command's only job is making
 * the record legible once it exists.
 *
 * THE READ PATH — and a defect found while wiring it: the usual way a CLI
 * command reaches a generically-typed stored node is
 * `@refarm.dev/sidecar-client`'s `createSidecarGraphClient` (see
 * `utils/tractor-store.ts`, used by `commands/health.ts`). Its `getNode` and
 * `queryNodes` both require every returned node to carry `@context`
 * (`asSidecarGraphNode`'s `hasContext` check). The Rust sidecar's `GET /nodes`
 * and `GET /nodes/:id` handlers (`packages/tractor/src/sidecar/mod.rs`,
 * `node_value_from_row`) never set `@context` on ANY node type — confirmed live
 * against a running daemon for `Session` nodes, not only `BudgetObservation`.
 * Going through that client throws "sidecar graph response includes malformed
 * node" (or "…missing node") the moment a query returns a real row; it happens
 * to look fine only while the record is empty. This command instead calls the
 * lower-level primitive that client is built from — `fetchSidecarJson` against
 * `GET /nodes?type=…`, the same pair `commands/dispatch-submit.ts` and
 * `commands/tasks.ts` already use for their own sidecar reads — and takes
 * `body.nodes` untyped, which is exactly the shape `summariseObservations`
 * expects. The `@context` gap in the shared client is a real, separate defect;
 * it is reported here (see the Task 11 report), not fixed, because fixing it
 * touches `packages/sidecar-client`, outside this task's file list and outside
 * the `apps/refarm/src` scope this change stages.
 */

const BUDGET_OBSERVATION_NODE_TYPE = "BudgetObservation";
const BUDGET_OBSERVATIONS_JSON_COMMAND = refarmCommand(["budget", "observations", "--json"]);
const DEFAULT_LIMIT = 100;

export type ObservationNode = Record<string, unknown>;

export type ObservationSummary = {
	total: number;
	timedOut: number;
	boundByNode: number;
	boundByWorkspace: number;
	/** Observations priced by a rate table that has since been superseded. */
	stalePricing: number;
	/** Observations written before the rate table was stamped at all. */
	unstampedPricing: number;
};

/** Pure reducer over the record. Kept separate from the command so the counting
 *  rule is testable without a running node. */
export function summariseObservations(
	nodes: readonly ObservationNode[],
	currentRateTable?: string,
): ObservationSummary {
	let timedOut = 0;
	let boundByNode = 0;
	let boundByWorkspace = 0;
	let stalePricing = 0;
	let unstampedPricing = 0;
	for (const node of nodes) {
		if (node["refarm.outcome"] === "timed-out") timedOut += 1;
		const boundBy = node["refarm.budget.bound_by"];
		if (boundBy === "node") boundByNode += 1;
		if (boundBy === "workspace") boundByWorkspace += 1;
		const stamped = node["refarm.cost.rate_table_version"];
		if (stamped === undefined) unstampedPricing += 1;
		else if (currentRateTable !== undefined && stamped !== currentRateTable) {
			stalePricing += 1;
		}
	}
	return {
		total: nodes.length,
		timedOut,
		boundByNode,
		boundByWorkspace,
		stalePricing,
		unstampedPricing,
	};
}

function parseLimitOption(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError("--limit must be a positive integer.");
	}
	return parsed;
}

async function fetchBudgetObservations(limit: number): Promise<ObservationNode[]> {
	const body = await fetchSidecarJson<{ nodes?: unknown[] }>(
		sidecarUrl(
			`/nodes?type=${encodeURIComponent(BUDGET_OBSERVATION_NODE_TYPE)}&limit=${limit}`,
		),
	);
	return Array.isArray(body.nodes) ? (body.nodes as ObservationNode[]) : [];
}

/**
 * Where the operator goes next — and, for `total === 0`, WHY that is not an
 * all-clear. This repository has already been bitten once by a gate reporting
 * success for work it never ran; a summariser that reads "0/0, nothing to
 * report" without saying so reproduces the exact same shape of lie. So an empty
 * record says plainly that nothing has been observed yet and names what would
 * fill it: every terminal effort (done, failed, timed-out, cancelled) writes
 * one row, governed by whichever level — node, workspace, declared, or
 * default — resolved for it. No `nextCommand` is offered for the empty case:
 * the thing that would fill the record is dispatching and finishing a real
 * workload (e.g. `refarm ask "…"`), which spends real budget and must not be
 * something a `--json` consumer follows automatically.
 */
function observationsNextAction(summary: ObservationSummary): string | null {
	if (summary.total === 0) {
		return (
			"No BudgetObservation records yet. One is written for every terminal effort " +
			"(done, failed, timed-out, or cancelled) — dispatch a workload through the " +
			'runtime (for example, refarm ask "…") and let it finish, then run this again.'
		);
	}
	if (summary.stalePricing > 0) {
		return (
			`${summary.stalePricing} observation(s) were priced by a rate table that has ` +
			"since been superseded — their token counts are still true, so the cost is " +
			"recomputable from the stamped rate_table_version."
		);
	}
	return null;
}

function outcomeMark(outcome: string): string {
	switch (outcome) {
		case "done":
			return chalk.green("●");
		case "timed-out":
			return chalk.yellow("⏱");
		case "failed":
			return chalk.red("✗");
		case "cancelled":
			return chalk.dim("⊘");
		default:
			return chalk.dim("·");
	}
}

function printObservationsHuman(
	observations: readonly ObservationNode[],
	summary: ObservationSummary,
): void {
	console.log(chalk.bold(`\n  Budget observations  (${summary.total} shown)\n`));
	if (summary.total === 0) {
		console.log(chalk.dim(`  ${observationsNextAction(summary) ?? ""}`));
		return;
	}
	console.log(
		chalk.dim(
			`  timed-out: ${summary.timedOut}   bound-by-node: ${summary.boundByNode}   ` +
				`bound-by-workspace: ${summary.boundByWorkspace}   ` +
				`stale-pricing: ${summary.stalePricing}   unstamped-pricing: ${summary.unstampedPricing}\n`,
		),
	);
	for (const node of observations) {
		const outcome = typeof node["refarm.outcome"] === "string" ? node["refarm.outcome"] : "?";
		const boundBy =
			typeof node["refarm.budget.bound_by"] === "string" ? node["refarm.budget.bound_by"] : "?";
		const effortId = typeof node.effort_id === "string" ? node.effort_id : "?";
		console.log(
			`  ${outcomeMark(outcome as string)} ${(outcome as string).padEnd(10)} ` +
				`bound-by:${(boundBy as string).padEnd(10)} ${chalk.dim(effortId as string)}`,
		);
	}
	console.log(chalk.dim(`\n  ${BUDGET_OBSERVATIONS_JSON_COMMAND}\n`));
}

interface BudgetObservationsCommandOptions {
	limit: number;
	currentRateTable?: string;
	json?: boolean;
}

export function createBudgetCommand(): Command {
	const command = new Command("budget").description(
		"Inspect the durable BudgetObservation record every terminal effort leaves",
	);

	command
		.command("observations")
		.description("List BudgetObservation nodes and summarise which ceiling cut what")
		.option("-n, --limit <n>", "Max observations to read", parseLimitOption, DEFAULT_LIMIT)
		.option(
			"--current-rate-table <version>",
			"Compare each observation's stamp against this rate table version to count stale pricing " +
				"(omit to leave staleness undetermined rather than guessed)",
		)
		.option("--json", "Output machine-readable JSON")
		.action(async (options: BudgetObservationsCommandOptions) => {
			let observations: ObservationNode[];
			try {
				observations = await fetchBudgetObservations(options.limit);
			} catch (err) {
				reportSidecarError(err, {
					json: options.json,
					command: "budget",
					operation: "observations",
				});
				return;
			}
			const summary = summariseObservations(observations, options.currentRateTable);
			const nextAction = observationsNextAction(summary);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "budget",
						operation: "observations",
						extra: {
							observations,
							summary,
						},
						nextAction,
					}),
				);
				return;
			}
			printObservationsHuman(observations, summary);
		});

	command.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm budget observations",
			"  $ refarm budget observations --json",
			"  $ refarm budget observations --limit 50 --json",
			"  $ refarm budget observations --current-rate-table 2026-08-03.1 --json",
			"",
			"Notes:",
			"  A BudgetObservation is written for every terminal effort — this command only reads it.",
			"  Each --json observation carries refarm.outcome, refarm.budget.bound_by, and the",
			"  flattened gen_ai.usage.* / refarm.cost.* fields, per the Task 10 record shape.",
			"  No refarm dispatch --budget-* flag exists yet, so the record fills from whatever",
			"  budget level (node/workspace/declared/default) resolved for a run, not a declared one.",
		].join("\n"),
	);

	return command;
}

export const budgetCommand = createBudgetCommand();
