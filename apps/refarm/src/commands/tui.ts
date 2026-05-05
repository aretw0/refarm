import {
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	createLaunchProcessSpec,
	launchProcess,
} from "./launch-process.js";
import {
	launchAvailabilityMessage,
} from "./launch-feedback.js";
import { executeRendererLaunchFlow } from "./launch-flow.js";
import { assertLaunchGuardOptions } from "./launch-guards.js";
import { resolveLaunchMode } from "./launch-policy.js";
import { runStatusPreflight } from "./status-preflight.js";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";
import {
	resolveJsonMarkdownStatusOutputMode,
} from "./status-output.js";

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
		return createLaunchProcessSpec("cargo run -p tractor -- prompt");
	}

	return createLaunchProcessSpec("cargo run -p tractor -- watch");
}

export function launchTuiProcess(spec: TuiLaunchSpec): Promise<number> {
	return launchProcess(spec);
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
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--markdown", "Output markdown report")
		.option("--launch", "Launch TUI runtime after renderer preflight")
		.option("--dry-run", "Print launcher command without executing it")
		.option("--launcher <mode>", "Launcher mode: watch | prompt", "watch")
		.action(async (options: TuiOptions) => {
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
			const outputMode = resolveJsonMarkdownStatusOutputMode({
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
						console.log(
							launchAvailabilityMessage("TUI", TUI_LAUNCHER_MODES),
						);
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
			});
		});
}

export const tuiCommand = createTuiCommand();
