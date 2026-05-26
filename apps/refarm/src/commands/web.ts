import {
	openHostBrowserUrl,
	resolveBrowserOpenSpec,
} from "@refarm.dev/cli/browser-open";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import { formatRefarmActionReadinessOutput } from "./action-affordances.js";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import {
	launchAvailabilityMessage,
	openDryRunMessage,
	openFailureMessage,
	openStartMessage,
} from "./launch-feedback.js";
import { executeRendererLaunchFlow } from "./launch-flow.js";
import { assertLaunchGuardOptions, resolveLaunchGuardError } from "./launch-guards.js";
import { resolveLaunchMode } from "./launch-policy.js";
import { launchProcess, type LaunchProcessSpec } from "./launch-process.js";
import {
	createPackageScriptCommand,
	PACKAGE_MANAGERS,
} from "./package-manager.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { runStatusPreflight } from "./status-preflight.js";
import {
	printStatusSummary,
	resolveStatusPayload,
	type ResolveStatusPayloadResult,
} from "./status.js";
const WEB_LAUNCHER_MODES = ["dev", "preview"] as const;

export type RefarmWebLauncherMode = (typeof WEB_LAUNCHER_MODES)[number];

export type WebLaunchSpec = LaunchProcessSpec;

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
	actions?: boolean;
	select?: string;
	launcher?: RefarmWebLauncherMode;
}

export function resolveWebLaunchSpec(
	mode: RefarmWebLauncherMode,
): WebLaunchSpec {
	const script = mode === "preview" ? "preview" : "dev";
	return createPackageScriptCommand({ cwd: "apps/dev", script });
}

export function launchWebProcess(spec: WebLaunchSpec): Promise<number> {
	return launchProcess(spec);
}

export { resolveBrowserOpenSpec };

export async function openBrowserUrl(url: string): Promise<void> {
	await openHostBrowserUrl(url);
}

function webLaunchCommand(options: {
	launcher: RefarmWebLauncherMode;
	open?: boolean;
	openUrl?: string;
}): string {
	return refarmCommand([
		"web",
		"--launch",
		"--launcher",
		options.launcher,
		...(options.open ? ["--open"] : []),
		...(options.open && options.openUrl
			? ["--open-url", quoteCommandArg(options.openUrl)]
			: []),
	]);
}

function webActionsSelectCommand(select: string): string {
	return refarmCommand([
		"web",
		"--actions",
		"--select",
		quoteCommandArg(select),
		"--json",
	]);
}

function webLaunchGuardRecoveryCommand(options: WebOptions): string {
	const launcher = resolveLaunchMode(options.launcher ?? "dev", WEB_LAUNCHER_MODES);
	return refarmCommand([
		"web",
		"--launch",
		"--launcher",
		launcher,
		"--dry-run",
		"--json",
	]);
}

function emitWebLaunchGuardError(options: WebOptions): boolean {
	const input = {
		json: options.json,
		markdown: options.markdown,
		launch: options.launch,
		dryRun: options.dryRun,
		requiresLaunch: [{ enabled: options.open, flag: "--open" }],
	};
	const error = resolveLaunchGuardError(input);
	if (!error) return false;
	if (!options.json) {
		assertLaunchGuardOptions(input);
		return true;
	}
	const nextCommand = webLaunchGuardRecoveryCommand(options);
	printJson(
		buildJsonErrorEnvelope({
			command: "web",
			operation: "launch",
			error: error.code,
			message: error.message,
			nextAction: nextCommand,
			nextCommand,
			nextCommands: [nextCommand],
			extra: error.flag ? { flag: error.flag } : undefined,
		}),
	);
	process.exitCode = 1;
	return true;
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
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm web",
				"  $ refarm web --launch",
				"  $ refarm web --launch --open",
				"  $ refarm web --dry-run --launcher preview",
				"  $ refarm web --launch --dry-run --json",
				"  $ refarm web --actions",
				"",
				"Notes:",
				"  Without --launch, this runs a renderer preflight only.",
				"  --dry-run prints launch readiness and the resolved process command without starting it.",
				`  Override package-manager detection with REFARM_PACKAGE_MANAGER=${PACKAGE_MANAGERS.join("|")}.`,
				"  --open follows operator.openExternalLinks; set it with refarm config.",
			].join("\n"),
		)
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--markdown", "Output markdown report")
		.option("--launch", "Launch the local web runtime after renderer preflight")
		.option("--dry-run", "Print launch readiness without executing it")
		.option("--open", "Open default browser after starting web runtime")
		.option("--actions", "Output selectable Web surface action rows")
		.option(
			"--select <id-or-index>",
			"Select an available Web action ID or row index when used with --actions",
		)
		.option(
			"--open-url <url>",
			"Browser URL used with --open",
			"http://127.0.0.1:4321",
		)
		.option(
			"--launcher <mode>",
			"Launcher mode: dev | preview",
			(value) => resolveLaunchMode(value, WEB_LAUNCHER_MODES),
			"dev",
		)
		.action(async (options: WebOptions) => {
			if (options.select && !options.actions) {
				if (options.json) {
					const nextCommand = webActionsSelectCommand(options.select);
					printJson(
						buildJsonErrorEnvelope({
							command: "web",
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
				assertWebActionsOutputOptions(options);
				await emitWebActionRows(options, resolvedDeps);
				return;
			}

			if (emitWebLaunchGuardError(options)) return;

			const launchMode = resolveLaunchMode(
				options.launcher ?? "dev",
				WEB_LAUNCHER_MODES,
			);
			const outputMode = options.launch && options.dryRun && options.json
				? "silent"
				: resolveJsonMarkdownStatusOutputMode({
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
						console.log(launchAvailabilityMessage("Web", WEB_LAUNCHER_MODES));
					}
				},
			});

			await executeRendererLaunchFlow({
				launch: options.launch,
				dryRun: options.dryRun,
				status: json,
				launchGuardTarget: "web runtime",
				bannerExperience: "web",
				dryRunRuntimeLabel: "web runtime",
				startRuntimeLabel: "web runtime",
				resolveLaunchSpec: () => resolveWebLaunchSpec(launchMode),
				launchProcess: resolvedDeps.launch,
				dryRunJson: options.json,
				dryRunJsonCommand: "web",
				dryRunJsonNextCommand: webLaunchCommand({
					launcher: launchMode,
					open: options.open,
					openUrl,
				}),
				dryRunJsonExtra: () => ({
					renderer: "web",
					launcher: launchMode,
					open: options.open === true,
					...(options.open ? { openUrl } : {}),
				}),
				onDryRun: () => {
					if (options.open && !options.json) {
						console.log(openDryRunMessage(openUrl));
					}
				},
				onLaunchStarted: async () => {
					if (options.open) {
						console.log(openStartMessage(openUrl));
						try {
							await resolvedDeps.open(openUrl);
						} catch (error) {
							console.error(openFailureMessage(error));
						}
					}
				},
			});
		});
}

async function emitWebActionRows(
	options: WebOptions,
	deps: WebDeps,
): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload: deps.resolveStatusPayload,
		resolveOptions: {
			renderer: "web",
			input: options.input,
		},
		run: (json) => {
			console.log(
				formatRefarmActionReadinessOutput(json, {
					renderer: "web",
					json: options.json,
					select: options.select,
					unavailableSubject: "Web action",
					rowsHeading: "Available Web actions:",
					selectedHeading: "Selected Web action:",
				}),
			);
		},
	});
}

function assertWebActionsOutputOptions(options: WebOptions): void {
	if (options.markdown || options.launch || options.dryRun || options.open) {
		throw new Error(
			"--actions cannot be combined with --markdown, --launch, --dry-run, or --open.",
		);
	}
}

export const webCommand = createWebCommand();
