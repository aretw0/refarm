import { spawn } from "node:child_process";
import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";

export type RefarmWebLauncherMode = "dev" | "preview";

export interface WebLaunchSpec {
	command: string;
	args: string[];
	display: string;
}

export interface WebDeps {
	resolveStatusPayload(options: {
		renderer: string;
		input?: string;
	}): Promise<ResolveStatusPayloadResult>;
	printStatusSummary(json: RefarmStatusJson): void;
	launch(spec: WebLaunchSpec): Promise<number>;
}

interface WebOptions {
	input?: string;
	json?: boolean;
	markdown?: boolean;
	launch?: boolean;
	dryRun?: boolean;
	launcher?: RefarmWebLauncherMode;
}

function splitNpmCommand(command: string): { command: string; args: string[] } {
	const parts = command.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("Invalid launcher command.");
	}
	return {
		command: parts[0],
		args: parts.slice(1),
	};
}

export function resolveWebLaunchSpec(
	mode: RefarmWebLauncherMode,
): WebLaunchSpec {
	if (mode === "preview") {
		const parsed = splitNpmCommand("npm --prefix apps/dev run preview");
		return {
			...parsed,
			display: "npm --prefix apps/dev run preview",
		};
	}

	const parsed = splitNpmCommand("npm --prefix apps/dev run dev");
	return {
		...parsed,
		display: "npm --prefix apps/dev run dev",
	};
}

export function launchWebProcess(spec: WebLaunchSpec): Promise<number> {
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

export function createWebCommand(deps?: Partial<WebDeps>): Command {
	const resolvedDeps: WebDeps = {
		resolveStatusPayload,
		printStatusSummary,
		launch: launchWebProcess,
		...deps,
	};

	return new Command("web")
		.description(
			"Report web renderer posture and optionally launch local web runtime",
		)
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--markdown", "Output markdown report")
		.option("--launch", "Launch the local web runtime after renderer preflight")
		.option("--dry-run", "Print launcher command without executing it")
		.option("--launcher <mode>", "Launcher mode: dev | preview", "dev")
		.action(async (options: WebOptions) => {
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

			const launchMode = options.launcher === "preview" ? "preview" : "dev";
			const { json, shutdown } = await resolvedDeps.resolveStatusPayload({
				renderer: "web",
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
						"Web launcher integration is available via --launch (dev|preview).",
					);
				}
			}

			await shutdown?.();

			if (options.launch) {
				if (!json.runtime.ready) {
					throw new Error(
						"Cannot launch web runtime: status reports runtime:not-ready.",
					);
				}
				const spec = resolveWebLaunchSpec(launchMode);
				if (options.dryRun) {
					console.log(`[dry-run] would launch web runtime: ${spec.display}`);
					return;
				}
				console.log(`Launching web runtime: ${spec.display}`);
				const code = await resolvedDeps.launch(spec);
				if (code !== 0) {
					process.exitCode = code;
				}
			}
		});
}

export const webCommand = createWebCommand();
