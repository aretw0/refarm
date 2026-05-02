import {
	classifyRefarmStatusDiagnostics,
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { spawn } from "node:child_process";
import { Command } from "commander";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";

export type RefarmTuiLauncherMode = "watch" | "prompt";

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

function splitCommand(command: string): { command: string; args: string[] } {
	const parts = command.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("Invalid launcher command.");
	}

	return {
		command: parts[0],
		args: parts.slice(1),
	};
}

export function resolveTuiLaunchSpec(mode: RefarmTuiLauncherMode): TuiLaunchSpec {
	if (mode === "prompt") {
		const parsed = splitCommand("cargo run -p tractor -- prompt");
		return {
			...parsed,
			display: "cargo run -p tractor -- prompt",
		};
	}

	const parsed = splitCommand("cargo run -p tractor -- watch");
	return {
		...parsed,
		display: "cargo run -p tractor -- watch",
	};
}

export function launchTuiProcess(spec: TuiLaunchSpec): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: process.cwd(),
			stdio: "inherit",
			env: process.env,
		});

		child.once("error", (error) => {
			reject(error);
		});

		child.once("close", (code) => {
			resolve(code ?? 0);
		});
	});
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
			if (options.json && options.markdown) {
				throw new Error("Choose only one output format: --json or --markdown.");
			}
			if (options.launch && (options.json || options.markdown)) {
				throw new Error(
					"--launch cannot be combined with --json or --markdown.",
				);
			}
			if (options.dryRun && !options.launch) {
				throw new Error("--dry-run requires --launch.");
			}

			const launchMode = options.launcher === "prompt" ? "prompt" : "watch";

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
					console.log(
						"TUI launcher integration is available via --launch (watch|prompt).",
					);
				}
			}

			await shutdown?.();

			if (options.launch) {
				const diagnostics = classifyRefarmStatusDiagnostics(json);
				if (diagnostics.failures.length > 0) {
					throw new Error(
						`Cannot launch TUI runtime due status failures: ${diagnostics.failures.join(", ")}.`,
					);
				}

				const spec = resolveTuiLaunchSpec(launchMode);
				if (options.dryRun) {
					console.log(`[dry-run] would launch tui runtime: ${spec.display}`);
					return;
				}

				console.log(`Launching TUI runtime: ${spec.display}`);
				const code = await resolvedDeps.launch(spec);
				if (code !== 0) {
					process.exitCode = code;
				}
			}
		});
}

export const tuiCommand = createTuiCommand();
