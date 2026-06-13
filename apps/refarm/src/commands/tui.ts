import {
	createLaunchProcessSpec,
	launchProcess,
	type LaunchProcessSpec,
} from "@refarm.dev/cli/launch-process";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import { formatSurfaceActionReadinessOutput } from "./action-affordances.js";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import { launchAvailabilityMessage } from "./launch-feedback.js";
import { executeRendererLaunchFlow } from "./launch-flow.js";
import { assertLaunchGuardOptions, resolveLaunchGuardError } from "./launch-guards.js";
import { resolveLaunchMode } from "./launch-policy.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND
} from "./runtime-recovery.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { runStatusPreflight } from "./status-preflight.js";
import {
	printStatusSummary,
	resolveStatusPayload,
	type ResolveStatusPayloadResult,
} from "./status.js";
const TUI_LAUNCHER_MODES = ["watch", "prompt"] as const;

export type RefarmTuiLauncherMode = (typeof TUI_LAUNCHER_MODES)[number];

export type TuiLaunchSpec = LaunchProcessSpec;

interface TuiOptions {
	input?: string;
	json?: boolean;
	markdown?: boolean;
	launch?: boolean;
	dryRun?: boolean;
	actions?: boolean;
	select?: string;
	launcher?: RefarmTuiLauncherMode;
}

interface TuiDeps {
	resolveStatusPayload(options: {
		renderer: string;
		input?: string;
	}): Promise<ResolveStatusPayloadResult>;
	printStatusSummary(json: RefarmStatusJson): void;
	launch(spec: TuiLaunchSpec): Promise<number>;
}

export function resolveTuiLaunchSpec(
	mode: RefarmTuiLauncherMode,
): TuiLaunchSpec {
	if (mode === "prompt") {
		return createLaunchProcessSpec("tractor prompt");
	}

	return createLaunchProcessSpec("tractor watch");
}

export function launchTuiProcess(spec: TuiLaunchSpec): Promise<number> {
	return launchProcess(spec);
}

function tuiLaunchCommand(launcher: RefarmTuiLauncherMode): string {
	return refarmCommand(["tui", "--launch", "--launcher", launcher]);
}

function tuiActionsSelectCommand(select: string): string {
	return refarmCommand([
		"tui",
		"--actions",
		"--select",
		quoteCommandArg(select),
		"--json",
	]);
}

function tuiLaunchGuardRecoveryCommand(options: TuiOptions): string {
	const launcher = resolveLaunchMode(options.launcher ?? "watch", TUI_LAUNCHER_MODES);
	return refarmCommand([
		"tui",
		"--launch",
		"--launcher",
		launcher,
		"--dry-run",
		"--json",
	]);
}

function emitTuiLaunchGuardError(options: TuiOptions): boolean {
	const error = resolveLaunchGuardError({
		json: options.json,
		markdown: options.markdown,
		launch: options.launch,
		dryRun: options.dryRun,
	});
	if (!error) return false;
	if (!options.json) {
		assertLaunchGuardOptions({
			json: options.json,
			markdown: options.markdown,
			launch: options.launch,
			dryRun: options.dryRun,
		});
		return true;
	}
	const nextCommand = tuiLaunchGuardRecoveryCommand(options);
	printJson(
		buildJsonErrorEnvelope({
			command: "tui",
			operation: "launch",
			error: error.code,
			message: error.message,
			nextAction: nextCommand,
			nextCommand,
			nextCommands: [nextCommand],
		}),
	);
	process.exitCode = 1;
	return true;
}

export function createTuiCommand(deps?: Partial<TuiDeps>): Command {
	const resolvedDeps: TuiDeps = {
		resolveStatusPayload,
		printStatusSummary,
		launch: launchTuiProcess,
		...deps,
	};

	return new Command("tui")
		.description(
			"Report TUI renderer posture and optionally launch local terminal runtime",
		)
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm tui",
				"  $ refarm tui --launch",
				"  $ refarm tui --launch --launcher prompt",
				"  $ refarm tui --dry-run",
				"  $ refarm tui --launch --dry-run --json",
				"  $ refarm tui --actions",
				"",
				"Notes:",
				"  Without --launch, this runs a renderer preflight only.",
				"  The TUI launcher uses the local tractor binary: tractor watch or tractor prompt.",
				`  Use ${RUNTIME_STATUS_COMMAND} to inspect the selected engine before launching.`,
				`  If runtime readiness is unclear, run ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND} or ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}.`,
				`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
			].join("\n"),
		)
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--markdown", "Output markdown report")
		.option("--launch", "Launch TUI runtime after renderer preflight")
		.option("--dry-run", "Print launch readiness without executing it")
		.option("--actions", "Output selectable TUI surface action rows")
		.option(
			"--select <id-or-index>",
			"Select an available TUI action ID or row index when used with --actions",
		)
		.option(
			"--launcher <mode>",
			"Launcher mode: watch | prompt",
			(value) => resolveLaunchMode(value, TUI_LAUNCHER_MODES),
			"watch",
		)
		.action(async (options: TuiOptions) => {
			if (options.select && !options.actions) {
				if (options.json) {
					const nextCommand = tuiActionsSelectCommand(options.select);
					printJson(
						buildJsonErrorEnvelope({
							command: "tui",
							operation: "actions",
							error: "select-requires-actions",
							message: "--select requires --actions.",
							nextAction: nextCommand,
							nextCommand,
							nextCommands: [nextCommand],
							extra: {
								select: options.select,
							},
						}),
					);
					process.exitCode = 1;
					return;
				}
				throw new Error("--select requires --actions.");
			}

			if (options.actions) {
				assertTuiActionsOutputOptions(options);
				await emitTuiActionRows(options, resolvedDeps);
				return;
			}

			if (emitTuiLaunchGuardError(options)) return;

			const launchMode = resolveLaunchMode(
				options.launcher ?? "watch",
				TUI_LAUNCHER_MODES,
			);
			const outputMode = options.launch && options.dryRun && options.json
				? "silent"
				: resolveJsonMarkdownStatusOutputMode({
						json: options.json,
						markdown: options.markdown,
						defaultMode: "summary",
					});

			const json = await runStatusPreflight({
				resolveStatusPayload: resolvedDeps.resolveStatusPayload,
				resolveOptions: {
					renderer: "tui",
					input: options.input,
				},
				outputMode,
				printSummary: resolvedDeps.printStatusSummary,
				afterEmit: () => {
					if (outputMode === "summary" && !options.launch) {
						console.log(launchAvailabilityMessage("TUI", TUI_LAUNCHER_MODES));
					}
				},
			});

			await executeRendererLaunchFlow({
				launch: options.launch,
				dryRun: options.dryRun,
				status: json,
				launchGuardTarget: "TUI runtime",
				bannerExperience: "tui",
				dryRunRuntimeLabel: "tui runtime",
				startRuntimeLabel: "TUI runtime",
				resolveLaunchSpec: () => resolveTuiLaunchSpec(launchMode),
				launchProcess: resolvedDeps.launch,
				dryRunJson: options.json,
				dryRunJsonCommand: "tui",
				dryRunJsonNextCommand: tuiLaunchCommand(launchMode),
				dryRunJsonExtra: () => ({
					renderer: "tui",
					launcher: launchMode,
				}),
			});
		});
}

async function emitTuiActionRows(
	options: TuiOptions,
	deps: TuiDeps,
): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload: deps.resolveStatusPayload,
		resolveOptions: {
			renderer: "tui",
			input: options.input,
		},
		run: (json) => {
			console.log(
				formatSurfaceActionReadinessOutput(json, {
					renderer: "tui",
					json: options.json,
					select: options.select,
					unavailableSubject: "TUI action",
					rowsHeading: "Available TUI actions:",
					selectedHeading: "Selected TUI action:",
				}),
			);
		},
	});
}

function assertTuiActionsOutputOptions(options: TuiOptions): void {
	if (options.markdown || options.launch || options.dryRun) {
		throw new Error(
			"--actions cannot be combined with --markdown, --launch, or --dry-run.",
		);
	}
}

export const tuiCommand = createTuiCommand();
