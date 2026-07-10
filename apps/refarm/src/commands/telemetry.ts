import { printJson } from "@refarm.dev/capabilities/envelope";
import {
	evaluatePressure,
	isPressureProfileName,
	type PressureDiagnostic,
	type PressureProfileName,
	type PressureSnapshot,
	type PressureWindow,
} from "@refarm.dev/pressure-contract-v1";
import {
	createPressureClient,
	SidecarHttpError,
} from "@refarm.dev/sidecar-client";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { refarmCommand } from "../brand.js";
import {
	buildDiagnosticNextActionPayload, diagnosticNextActions, diagnosticNextCommands, type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import {
	isSidecarUnavailable,
	printSidecarUnavailable,
	reportSidecarError,
} from "./sidecar-error.js";
import { resolveSidecarUrl } from "./sidecar-url.js";

const TASK_LIST_JSON_COMMAND = refarmCommand(["task", "list", "--json"]);
const FAILED_TASKS_JSON_COMMAND = refarmCommand([
	"tasks",
	"--status",
	"failed",
	"--json",
]);

export type TelemetryRecommendation = DiagnosticRecommendation;

export interface TelemetryDeps {
	fetchTelemetry(): Promise<PressureSnapshot>;
	fetchTelemetryWindow(minutes: number): Promise<PressureWindow | null>;
}

function parseDiagnosticList(raw: string | undefined): PressureDiagnostic[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parsePositiveIntOption(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError(`${label} must be a positive integer.`);
	}
	return parsed;
}

function parsePositiveNumberOption(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new InvalidArgumentError(`${label} must be a positive number.`);
	}
	return parsed;
}

function toPositiveInt(raw: number | string | undefined, fallback: number): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

function parseThresholdProfile(value: string): PressureProfileName {
	if (isPressureProfileName(value)) {
		return value;
	}
	throw new InvalidArgumentError(
		`invalid profile "${value}". Use: conservative | balanced | throughput`,
	);
}

async function fetchTelemetryFromSidecar(): Promise<PressureSnapshot> {
	const pressure = createPressureClient(resolveSidecarUrl());
	try {
		return await pressure.getSnapshot();
	} catch (err) {
		if (err instanceof SidecarHttpError && err.status === 404) {
			throw new Error("telemetry endpoint not available");
		}
		throw err;
	}
}

async function fetchTelemetryWindowFromSidecar(
	minutes: number,
): Promise<PressureWindow | null> {
	return createPressureClient(resolveSidecarUrl()).getWindow(minutes);
}

function formatSummary(snapshot: PressureSnapshot): string[] {
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

export function buildTelemetryRecommendations(
	diagnostics: string[],
): TelemetryRecommendation[] {
	return diagnostics.map((diagnostic) => {
		switch (diagnostic) {
			case "saturation:queue":
				return {
					diagnostic,
					summary: "The task queue is above the configured warning threshold.",
					action: "Reduce new submissions, scale workers, or inspect long-running efforts before dispatching more work.",
					command: TASK_LIST_JSON_COMMAND,
				};
			case "saturation:inflight":
				return {
					diagnostic,
					summary: "In-flight effort count is above the configured warning threshold.",
					action: "Wait for active efforts to settle or increase worker capacity before starting more work.",
					command: TASK_LIST_JSON_COMMAND,
				};
			case "reliability:failures-present":
				return {
					diagnostic,
					summary: "Failed efforts are present in the current telemetry snapshot.",
					action: "Inspect failed effort logs and retry only after the failure cause is understood.",
					command: TASK_LIST_JSON_COMMAND,
				};
			case "reliability:failures-recent":
				return {
					diagnostic,
					summary: "Recent telemetry window includes failed efforts.",
					action: "Inspect recent failures before continuing automated execution.",
					command: FAILED_TASKS_JSON_COMMAND,
				};
			case "reliability:failure-rate":
				return {
					diagnostic,
					summary: "Recent failure rate is above the configured warning threshold.",
					action: "Pause non-essential automation and investigate the dominant failing tasks.",
					command: FAILED_TASKS_JSON_COMMAND,
				};
			default:
				return {
					diagnostic,
					summary: `Telemetry diagnostic ${diagnostic} is present.`,
					action: "Inspect pressure payload and host logs for the diagnostic source.",
					command: RUNTIME_DOCTOR_NEXT_COMMAND,
				};
		}
	});
}

function printConnectionFailure(message: string): void {
	if (isSidecarUnavailable(message)) {
		printSidecarUnavailable();
	} else if (message.includes("telemetry endpoint not available")) {
		console.error(
			chalk.red("✗  telemetry endpoint is unavailable in this daemon."),
		);
		console.error(chalk.dim("   Update or restart the Refarm runtime and retry."));
	} else {
		console.error(chalk.red(`✗  ${message}`));
	}
	process.exitCode = 1;
}

export function createTelemetryCommand(deps?: TelemetryDeps): Command {
	const resolved: TelemetryDeps = deps ?? {
		fetchTelemetry: fetchTelemetryFromSidecar,
		fetchTelemetryWindow: fetchTelemetryWindowFromSidecar,
	};

	return new Command("telemetry")
		.description(
			"Show pressure snapshot and saturation/reliability signals",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--next-action", "Print only the first telemetry recovery action")
		.option(
			"--profile <name>",
			"Threshold profile: conservative | balanced | throughput",
			parseThresholdProfile,
			"balanced",
		)
		.option(
			"--window-minutes <n>",
			"Rolling window size in minutes",
			(value) => parsePositiveIntOption(value, "--window-minutes"),
			60,
		)
		.option("--queue-warn <n>", "Warn threshold for queue depth", (value) =>
			parsePositiveIntOption(value, "--queue-warn"),
		)
		.option(
			"--inflight-warn <n>",
			"Warn threshold for in-flight efforts",
			(value) => parsePositiveIntOption(value, "--inflight-warn"),
		)
		.option(
			"--fail-rate-warn <pct>",
			"Warn threshold for rolling-window failure rate (%)",
			(value) => parsePositiveNumberOption(value, "--fail-rate-warn"),
		)
		.option("--strict", "Exit non-zero when selected diagnostics are present")
		.option(
			"--strict-on <codes>",
			"Comma-separated diagnostic codes to enforce in strict mode (default: all diagnostics)",
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm telemetry
  $ refarm telemetry --profile conservative
  $ refarm telemetry --json --strict
  $ refarm telemetry --next-action
  $ refarm telemetry --next-action --json
  $ refarm telemetry --json --strict-on saturation:queue,reliability:failure-rate

Notes:
  Use --strict in automation when telemetry pressure should fail the current step.
  If telemetry cannot reach the local runtime, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.
  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.
  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.
`,
		)
		.action(
			async (opts: {
				json?: boolean;
				nextAction?: boolean;
				profile?: PressureProfileName;
				windowMinutes?: number;
				queueWarn?: number;
				inflightWarn?: number;
				failRateWarn?: number;
				strict?: boolean;
				strictOn?: string;
			}) => {
				const profileName = opts.profile ?? "balanced";
				const windowMinutes = toPositiveInt(opts.windowMinutes, 60);

				let snapshot: PressureSnapshot;
				try {
					snapshot = await resolved.fetchTelemetry();
				} catch (err) {
					if (opts.json) {
						reportSidecarError(err, {
							json: true,
							command: "telemetry",
							operation: "snapshot",
						});
					} else {
						const message = err instanceof Error ? err.message : String(err);
						printConnectionFailure(message);
					}
					return;
				}

				let window: PressureWindow | null = null;
				try {
					window = await resolved.fetchTelemetryWindow(windowMinutes);
				} catch (err) {
					if (opts.json) {
						reportSidecarError(err, {
							json: true,
							command: "telemetry",
							operation: "window",
						});
					} else {
						const message = err instanceof Error ? err.message : String(err);
						printConnectionFailure(message);
					}
					return;
				}

				const pressure = evaluatePressure({
					snapshot,
					window,
					profile: profileName,
					thresholds: {
						queueWarn: opts.queueWarn,
						inflightWarn: opts.inflightWarn,
						failRateWarn: opts.failRateWarn,
					},
					strict: opts.strict,
					strictOn: parseDiagnosticList(opts.strictOn),
				});
				const { diagnostics, strict } = pressure;
				const recommendations = buildTelemetryRecommendations(diagnostics);
				const nextActions = diagnosticNextActions(recommendations);
				const nextCommands = diagnosticNextCommands(recommendations);

				const payload = {
					command: "telemetry",
					operation: "snapshot",
					ok: pressure.ok,
					snapshot,
					window,
					thresholds: {
						...pressure.thresholds,
						windowMinutes,
					},
					diagnostics,
					recommendations,
					nextAction: nextActions[0] ?? null,
					nextActions,
					nextCommand: nextCommands[0] ?? null,
					nextCommands,
					strict,
				};

				if (opts.nextAction && opts.json) {
					printJson(
						buildDiagnosticNextActionPayload({
							ok: diagnostics.length === 0,
							nextActions,
							nextCommands,
							strict: payload.strict,
						}),
					);
					if (!strict.passed) {
						process.exitCode = 2;
					}
					return;
				}

				if (opts.nextAction) {
					const [action] = nextActions;
					if (action) console.log(action);
					if (!strict.passed) {
						process.exitCode = 2;
					}
					return;
				}

				if (opts.json) {
					printJson(payload);
					if (!strict.passed) {
						process.exitCode = 2;
					}
					return;
				}

				console.log(chalk.bold("\nRefarm Telemetry Snapshot\n"));
				for (const line of formatSummary(snapshot)) {
					console.log(line);
				}
				console.log(chalk.dim(`\n  generated: ${snapshot.generatedAt}`));
				console.log(
					chalk.dim(
						`  profile: ${profileName} (queue>=${pressure.thresholds.queueWarn}, in-flight>=${pressure.thresholds.inflightWarn}, fail-rate>=${pressure.thresholds.failRateWarn}%)`,
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
							"\n  recent window unavailable (update/restart the Refarm runtime to enable).",
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
				console.log(chalk.bold("\nRecommendations"));
				for (const item of recommendations) {
					console.log(chalk.gray(`  - ${item.diagnostic}: ${item.summary}`));
					console.log(chalk.gray(`    ${item.action}`));
				}

				if (!strict.passed) {
					console.error(
						chalk.red(
							`\n✗ strict telemetry gate failed (${strict.matchedDiagnostics.length} matching diagnostics).`,
						),
					);
					if (strict.targets.length > 0) {
						console.error(
							chalk.dim(`  enforced codes: ${strict.targets.join(", ")}`),
						);
					}
					process.exitCode = 2;
				}
			},
		);
}

export const telemetryCommand = createTelemetryCommand();
