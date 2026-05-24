import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import { formatRefarmActionReadinessOutput } from "./action-affordances.js";
import { refarmCommand } from "./command-handoff.js";
import { launchAvailabilityMessage } from "./launch-feedback.js";
import { executeRendererLaunchFlow } from "./launch-flow.js";
import { assertLaunchGuardOptions } from "./launch-guards.js";
import { resolveLaunchMode } from "./launch-policy.js";
import { createLaunchProcessSpec, launchProcess } from "./launch-process.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
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

export interface TuiLaunchSpec {
	command: string;
	args: string[];
	display: string;
}

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
				`  If runtime readiness is unclear, run ${RUNTIME_START_WAIT_COMMAND} or ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}.`,
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
				throw new Error("--select requires --actions.");
			}

			if (options.actions) {
				assertTuiActionsOutputOptions(options);
				await emitTuiActionRows(options, resolvedDeps);
				return;
			}

			assertLaunchGuardOptions({
				json: options.json,
				markdown: options.markdown,
				launch: options.launch,
				dryRun: options.dryRun,
			});

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
				formatRefarmActionReadinessOutput(json, {
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
