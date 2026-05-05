import chalk from "chalk";
import { Command } from "commander";

const SIDECAR_URL = "http://127.0.0.1:42001";

export interface RuntimeVisibilitySnapshot {
	queueDepth: number;
	inFlight: number;
	cancelRequests: number;
	generatedAt: string;
	total: number;
	pending: number;
	inProgress: number;
	done: number;
	failed: number;
	cancelled: number;
}

export interface VisibilityDeps {
	fetchVisibility(): Promise<RuntimeVisibilitySnapshot>;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

async function fetchVisibilityFromSidecar(): Promise<RuntimeVisibilitySnapshot> {
	const response = await fetch(`${SIDECAR_URL}/visibility`);
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error("visibility endpoint not available");
		}
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	return (await response.json()) as RuntimeVisibilitySnapshot;
}

function formatSummary(snapshot: RuntimeVisibilitySnapshot): string[] {
	return [
		`  queue depth   : ${snapshot.queueDepth}`,
		`  in-flight     : ${snapshot.inFlight}`,
		`  cancel reqs   : ${snapshot.cancelRequests}`,
		`  efforts total : ${snapshot.total}`,
		`  pending       : ${snapshot.pending}`,
		`  in-progress   : ${snapshot.inProgress}`,
		`  done          : ${snapshot.done}`,
		`  failed        : ${snapshot.failed}`,
		`  cancelled     : ${snapshot.cancelled}`,
	];
}

export function createVisibilityCommand(deps?: VisibilityDeps): Command {
	const resolved: VisibilityDeps = deps ?? {
		fetchVisibility: fetchVisibilityFromSidecar,
	};

	return new Command("visibility")
		.description("Show runtime visibility snapshot and pressure signals")
		.option("--json", "Output machine-readable JSON")
		.option("--queue-warn <n>", "Warn threshold for queue depth", "10")
		.option("--inflight-warn <n>", "Warn threshold for in-flight efforts", "4")
		.action(
			async (opts: {
				json?: boolean;
				queueWarn?: string;
				inflightWarn?: string;
			}) => {
				const queueWarn = toPositiveInt(opts.queueWarn, 10);
				const inflightWarn = toPositiveInt(opts.inflightWarn, 4);

				let snapshot: RuntimeVisibilitySnapshot;
				try {
					snapshot = await resolved.fetchVisibility();
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
						console.error(chalk.red("✗  farmhand is not running."));
						console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
					} else if (msg.includes("visibility endpoint not available")) {
						console.error(
							chalk.red("✗  visibility endpoint is unavailable in this daemon."),
						);
						console.error(
							chalk.dim("   Update/restart farmhand and retry."),
						);
					} else {
						console.error(chalk.red(`✗  ${msg}`));
					}
					process.exit(1);
				}

				const diagnostics: string[] = [];
				if (snapshot.queueDepth >= queueWarn) diagnostics.push("pressure:queue-depth");
				if (snapshot.inFlight >= inflightWarn)
					diagnostics.push("pressure:in-flight");
				if (snapshot.failed > 0) diagnostics.push("efforts:failed-present");

				if (opts.json) {
					console.log(
						JSON.stringify(
							{
								snapshot,
								thresholds: { queueWarn, inflightWarn },
								diagnostics,
							},
							null,
							2,
						),
					);
					return;
				}

				console.log(chalk.bold("\nRefarm Visibility Snapshot\n"));
				for (const line of formatSummary(snapshot)) {
					console.log(line);
				}
				console.log(chalk.dim(`\n  generated: ${snapshot.generatedAt}`));

				if (diagnostics.length === 0) {
					console.log(chalk.green("\n  ✓ no pressure signals"));
					return;
				}

				console.log(chalk.yellow("\n  ⚠ pressure signals detected:"));
				for (const item of diagnostics) {
					console.log(chalk.yellow(`    - ${item}`));
				}
			},
		);
}

export const visibilityCommand = createVisibilityCommand();
