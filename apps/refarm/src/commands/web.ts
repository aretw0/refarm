import {
	openHostBrowserUrl,
	resolveBrowserOpenSpec,
} from "@refarm.dev/cli/browser-open";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import { formatRefarmActionReadinessOutput } from "./action-affordances.js";
import {
	launchAvailabilityMessage,
	openDryRunMessage,
	openFailureMessage,
	openStartMessage,
} from "./launch-feedback.js";
import { executeRendererLaunchFlow } from "./launch-flow.js";
import { createLaunchProcessSpec, launchProcess } from "./launch-process.js";
import { assertLaunchGuardOptions } from "./launch-guards.js";
import { resolveLaunchMode } from "./launch-policy.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { runStatusPreflight } from "./status-preflight.js";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";
const WEB_LAUNCHER_MODES = ["dev", "preview"] as const;

export type RefarmWebLauncherMode = (typeof WEB_LAUNCHER_MODES)[number];

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
	if (mode === "preview") {
		return createLaunchProcessSpec("pnpm -C apps/dev run preview");
	}

	return createLaunchProcessSpec("pnpm -C apps/dev run dev");
}

export function launchWebProcess(spec: WebLaunchSpec): Promise<number> {
	return launchProcess(spec);
}

export { resolveBrowserOpenSpec };

export async function openBrowserUrl(url: string): Promise<void> {
	await openHostBrowserUrl(url);
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
		.option("--launcher <mode>", "Launcher mode: dev | preview", "dev")
		.action(async (options: WebOptions) => {
			if (options.select && !options.actions) {
				throw new Error("--select requires --actions.");
			}

			if (options.actions) {
				assertWebActionsOutputOptions(options);
				await emitWebActionRows(options, resolvedDeps);
				return;
			}

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
				onDryRun: () => {
					if (options.open) {
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
