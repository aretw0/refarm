import chalk from "chalk";
import { Command } from "commander";

const SIDECAR_URL = "http://127.0.0.1:42001";

type ThresholdProfileName = "conservative" | "balanced" | "throughput";

interface TelemetryThresholds {
	queueWarn: number;
	inflightWarn: number;
	failRateWarn: number;
}

const PROFILE_THRESHOLDS: Record<ThresholdProfileName, TelemetryThresholds> = {
	conservative: {
		queueWarn: 5,
		inflightWarn: 2,
		failRateWarn: 5,
	},
	balanced: {
		queueWarn: 10,
		inflightWarn: 4,
		failRateWarn: 15,
	},
	throughput: {
		queueWarn: 20,
		inflightWarn: 8,
		failRateWarn: 30,
	},
};

export interface RuntimeTelemetrySnapshot {
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

export interface RuntimeTelemetryWindow {
	windowMinutes: number;
	since: string;
	terminal: number;
	failureRatePct: number | null;
	generatedAt: string;
	total: number;
	pending: number;
	inProgress: number;
	done: number;
	failed: number;
	cancelled: number;
}

export interface TelemetryDeps {
	fetchTelemetry(): Promise<RuntimeTelemetrySnapshot>;
	fetchTelemetryWindow(minutes: number): Promise<RuntimeTelemetryWindow | null>;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

function toPositiveNumber(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Number(parsed);
}

function isThresholdProfileName(raw: string): raw is ThresholdProfileName {
	return raw === "conservative" || raw === "balanced" || raw === "throughput";
}

async function fetchTelemetryFromSidecar(): Promise<RuntimeTelemetrySnapshot> {
	const response = await fetch(`${SIDECAR_URL}/telemetry`);
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error("telemetry endpoint not available");
		}
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	return (await response.json()) as RuntimeTelemetrySnapshot;
}

async function fetchTelemetryWindowFromSidecar(
	minutes: number,
): Promise<RuntimeTelemetryWindow | null> {
	const response = await fetch(
		`${SIDECAR_URL}/telemetry/window?minutes=${minutes}`,
	);
	if (!response.ok) {
		if (response.status === 404) {
			return null;
		}
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	return (await response.json()) as RuntimeTelemetryWindow;
}

function formatSummary(snapshot: RuntimeTelemetrySnapshot): string[] {
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

function printConnectionFailure(message: string): never {
	if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
		console.error(chalk.red("✗  farmhand is not running."));
		console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
	} else if (message.includes("telemetry endpoint not available")) {
		console.error(chalk.red("✗  telemetry endpoint is unavailable in this daemon."));
		console.error(chalk.dim("   Update/restart farmhand and retry."));
	} else {
		console.error(chalk.red(`✗  ${message}`));
	}
	process.exit(1);
}

export function createTelemetryCommand(deps?: TelemetryDeps): Command {
	const resolved: TelemetryDeps = deps ?? {
		fetchTelemetry: fetchTelemetryFromSidecar,
		fetchTelemetryWindow: fetchTelemetryWindowFromSidecar,
	};

	return new Command("telemetry")
		.description("Show runtime telemetry snapshot and saturation/reliability signals")
		.option("--json", "Output machine-readable JSON")
		.option(
			"--profile <name>",
			"Threshold profile: conservative | balanced | throughput",
			"balanced",
		)
		.option("--window-minutes <n>", "Rolling window size in minutes", "60")
		.option("--queue-warn <n>", "Warn threshold for queue depth")
		.option("--inflight-warn <n>", "Warn threshold for in-flight efforts")
		.option(
			"--fail-rate-warn <pct>",
			"Warn threshold for rolling-window failure rate (%)",
		)
		.action(
			async (opts: {
				json?: boolean;
				profile?: string;
				windowMinutes?: string;
				queueWarn?: string;
				inflightWarn?: string;
				failRateWarn?: string;
			}) => {
				const profileName = opts.profile ?? "balanced";
				if (!isThresholdProfileName(profileName)) {
					console.error(
						chalk.red(
							`✗  invalid profile "${profileName}". Use: conservative | balanced | throughput`,
						),
					);
					process.exit(1);
				}

				const baseThresholds = PROFILE_THRESHOLDS[profileName];
				const thresholds = {
					queueWarn: toPositiveInt(opts.queueWarn, baseThresholds.queueWarn),
					inflightWarn: toPositiveInt(
						opts.inflightWarn,
						baseThresholds.inflightWarn,
					),
					failRateWarn: toPositiveNumber(
						opts.failRateWarn,
						baseThresholds.failRateWarn,
					),
				};
				const windowMinutes = toPositiveInt(opts.windowMinutes, 60);

				let snapshot: RuntimeTelemetrySnapshot;
				try {
					snapshot = await resolved.fetchTelemetry();
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					printConnectionFailure(message);
				}

				let window: RuntimeTelemetryWindow | null = null;
				try {
					window = await resolved.fetchTelemetryWindow(windowMinutes);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					printConnectionFailure(message);
				}

				const diagnostics: string[] = [];
				if (snapshot.queueDepth >= thresholds.queueWarn) {
					diagnostics.push("saturation:queue");
				}
				if (snapshot.inFlight >= thresholds.inflightWarn) {
					diagnostics.push("saturation:inflight");
				}
				if (snapshot.failed > 0) {
					diagnostics.push("reliability:failures-present");
				}
				if (window) {
					if (window.failed > 0) diagnostics.push("reliability:failures-recent");
					if (
						window.failureRatePct !== null &&
						window.failureRatePct >= thresholds.failRateWarn
					) {
						diagnostics.push("reliability:failure-rate");
					}
				}

				if (opts.json) {
					console.log(
						JSON.stringify(
							{
								snapshot,
								window,
								thresholds: {
									profile: profileName,
									windowMinutes,
									...thresholds,
								},
								diagnostics,
							},
							null,
							2,
						),
					);
					return;
				}

				console.log(chalk.bold("\nRefarm Telemetry Snapshot\n"));
				for (const line of formatSummary(snapshot)) {
					console.log(line);
				}
				console.log(chalk.dim(`\n  generated: ${snapshot.generatedAt}`));
				console.log(
					chalk.dim(
						`  profile: ${profileName} (queue>=${thresholds.queueWarn}, in-flight>=${thresholds.inflightWarn}, fail-rate>=${thresholds.failRateWarn}%)`,
					),
				);

				if (window) {
					console.log(chalk.bold("\nRecent Window\n"));
					console.log(`  minutes       : ${window.windowMinutes}`);
					console.log(`  since         : ${window.since}`);
					console.log(`  total         : ${window.total}`);
					console.log(`  terminal      : ${window.terminal}`);
					console.log(`  failed        : ${window.failed}`);
					console.log(
						`  failure rate  : ${window.failureRatePct ?? "n/a"}${
							window.failureRatePct === null ? "" : "%"
						}`,
					);
				} else {
					console.log(
						chalk.dim(
							"\n  recent window unavailable (update/restart farmhand to enable).",
						),
					);
				}

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

export const telemetryCommand = createTelemetryCommand();
