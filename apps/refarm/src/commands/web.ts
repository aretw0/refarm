import { spawn } from "node:child_process";
import { type RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import { printRefarmLaunchBanner } from "./brand.js";
import {
	launchAvailabilityMessage,
	launchDryRunMessage,
	launchStartMessage,
	openDryRunMessage,
	openFailureMessage,
	openStartMessage,
} from "./launch-feedback.js";
import {
	launchProcess,
	splitLaunchCommand,
} from "./launch-process.js";
import { assertLaunchGuardOptions } from "./launch-guards.js";
import { assertLaunchAllowed, resolveLaunchMode } from "./launch-policy.js";
import { runStatusPreflight } from "./status-preflight.js";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";
import {
	resolveJsonMarkdownStatusOutputMode,
} from "./status-output.js";

const WEB_LAUNCHER_MODES = ["dev", "preview"] as const;

export type RefarmWebLauncherMode = (typeof WEB_LAUNCHER_MODES)[number];

export interface WebLaunchSpec {
	command: string;
	args: string[];
	display: string;
}

export interface BrowserOpenSpec {
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
	open(url: string): Promise<void>;
}

interface WebOptions {
	input?: string;
	json?: boolean;
	markdown?: boolean;
	launch?: boolean;
	dryRun?: boolean;
	open?: boolean;
	openUrl?: string;
	launcher?: RefarmWebLauncherMode;
}

export function resolveWebLaunchSpec(
	mode: RefarmWebLauncherMode,
): WebLaunchSpec {
	if (mode === "preview") {
		const parsed = splitLaunchCommand("npm --prefix apps/dev run preview");
		return {
			...parsed,
			display: "npm --prefix apps/dev run preview",
		};
	}

	const parsed = splitLaunchCommand("npm --prefix apps/dev run dev");
	return {
		...parsed,
		display: "npm --prefix apps/dev run dev",
	};
}

export function launchWebProcess(spec: WebLaunchSpec): Promise<number> {
	return launchProcess(spec);
}

export function resolveBrowserOpenSpec(
	url: string,
	platform = process.platform,
): BrowserOpenSpec {
	if (platform === "darwin") {
		return {
			command: "open",
			args: [url],
			display: `open ${url}`,
		};
	}

	if (platform === "win32") {
		return {
			command: "cmd",
			args: ["/c", "start", "", url],
			display: `cmd /c start "" ${url}`,
		};
	}

	return {
		command: "xdg-open",
		args: [url],
		display: `xdg-open ${url}`,
	};
}

export function openBrowserUrl(url: string): Promise<void> {
	const spec = resolveBrowserOpenSpec(url);

	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: process.cwd(),
			stdio: "ignore",
			env: process.env,
		});

		child.once("error", (error) => {
			reject(error);
		});

		child.once("close", (code) => {
			if ((code ?? 0) === 0) {
				resolve();
				return;
			}

			reject(
				new Error(
					`Browser opener exited with code ${code ?? -1} (${spec.display}).`,
				),
			);
		});
	});
}

export function createWebCommand(deps?: Partial<WebDeps>): Command {
	const resolvedDeps: WebDeps = {
		resolveStatusPayload,
		printStatusSummary,
		launch: launchWebProcess,
		open: openBrowserUrl,
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
		.option("--open", "Open default browser after starting web runtime")
		.option(
			"--open-url <url>",
			"Browser URL used with --open",
			"http://127.0.0.1:4321",
		)
		.option("--launcher <mode>", "Launcher mode: dev | preview", "dev")
		.action(async (options: WebOptions) => {
			assertLaunchGuardOptions({
				json: options.json,
				markdown: options.markdown,
				launch: options.launch,
				dryRun: options.dryRun,
				requiresLaunch: [{ enabled: options.open, flag: "--open" }],
			});

			const launchMode = resolveLaunchMode(
				options.launcher ?? "dev",
				WEB_LAUNCHER_MODES,
			);
			const outputMode = resolveJsonMarkdownStatusOutputMode({
				json: options.json,
				markdown: options.markdown,
				defaultMode: "summary",
			});
			const openUrl = options.openUrl ?? "http://127.0.0.1:4321";
			const json = await runStatusPreflight({
				resolveStatusPayload: resolvedDeps.resolveStatusPayload,
				resolveOptions: {
					renderer: "web",
					input: options.input,
				},
				outputMode,
				printSummary: resolvedDeps.printStatusSummary,
				afterEmit: () => {
					if (outputMode === "summary" && !options.launch) {
						console.log(
							launchAvailabilityMessage("Web", WEB_LAUNCHER_MODES),
						);
					}
				},
			});

			if (options.launch) {
				assertLaunchAllowed(json, "web runtime");
				printRefarmLaunchBanner("web");
				const spec = resolveWebLaunchSpec(launchMode);
				if (options.dryRun) {
					console.log(launchDryRunMessage("web runtime", spec.display));
					if (options.open) {
						console.log(openDryRunMessage(openUrl));
					}
					return;
				}
				console.log(launchStartMessage("web runtime", spec.display));
				const launchPromise = resolvedDeps.launch(spec);
				if (options.open) {
					console.log(openStartMessage(openUrl));
					try {
						await resolvedDeps.open(openUrl);
					} catch (error) {
						console.error(openFailureMessage(error));
					}
				}
				const code = await launchPromise;
				if (code !== 0) {
					process.exitCode = code;
				}
			}
		});
}

export const webCommand = createWebCommand();
