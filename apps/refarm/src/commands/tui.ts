import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	launchProcess,
	splitLaunchCommand,
} from "./launch-process.js";
import {
	launchAvailabilityMessage,
	launchDryRunMessage,
	launchStartMessage,
} from "./launch-feedback.js";
import { assertLaunchGuardOptions } from "./launch-guards.js";
import { assertLaunchAllowed, resolveLaunchMode } from "./launch-policy.js";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
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
		const parsed = splitLaunchCommand("cargo run -p tractor -- prompt");
		return {
			...parsed,
			display: "cargo run -p tractor -- prompt",
		};
	}

	const parsed = splitLaunchCommand("cargo run -p tractor -- watch");
	return {
		...parsed,
		display: "cargo run -p tractor -- watch",
	};
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

			const { json, shutdown } = await resolvedDeps.resolveStatusPayload({
				renderer: "tui",
				input: options.input,
			});

			if (options.json) {
				console.log(formatRefarmStatusJson(json));
			} else if (options.markdown) {
				console.log(formatRefarmStatusMarkdown(json));
			} else {
				resolvedDeps.printStatusSummary(json);
				if (!options.launch) {
					console.log(launchAvailabilityMessage("TUI", TUI_LAUNCHER_MODES));
				}
			}

			await shutdown?.();

			if (options.launch) {
				assertLaunchAllowed(json, "TUI runtime");
				const spec = resolveTuiLaunchSpec(launchMode);
				if (options.dryRun) {
					console.log(launchDryRunMessage("tui runtime", spec.display));
					return;
				}

				console.log(launchStartMessage("TUI runtime", spec.display));
				const code = await resolvedDeps.launch(spec);
				if (code !== 0) {
					process.exitCode = code;
				}
			}
		});
}

export const tuiCommand = createTuiCommand();
