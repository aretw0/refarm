import {
	RUNTIME_ENGINE_MODES,
	type RuntimeSidecarProbeSummary,
	type RuntimeStatusSummary,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import {
	resolveRuntimeSidecarUrl,
	TRACTOR_ENGINE_ENV_VAR,
} from "../utils/runtime-config.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	RESUME_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { printJson } from "./json-output.js";
import {
	resolveRuntimeLaunchCommand,
	startRuntimeProcess,
	type RuntimeLaunchCommand,
} from "./runtime-launcher.js";
import {
	probeRuntimeReadiness,
	waitForRuntimeReady,
	type RuntimeReadinessProbe,
} from "./runtime-readiness.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_DRY_RUN_JSON_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import {
	findRepoRoot,
	readAutostartMode,
	readTractorEngineMode,
	resolveLaunchRuntime,
	type AutostartMode,
	type LaunchRuntimeSelection,
	type TractorEngineMode,
} from "./session-launch.js";

interface RuntimeCommandDeps {
	repoRoot(): string;
	readEngine(): TractorEngineMode;
	readAutostart(): AutostartMode;
	readSidecarUrl?(): { value: string; source: string };
	resolveRuntime(
		repoRoot: string,
		configuredEngine: TractorEngineMode,
	): LaunchRuntimeSelection;
	startRuntime?(command: RuntimeLaunchCommand): void;
	probeReadiness?(): Promise<RuntimeReadinessProbe>;
	probeReady?(): Promise<boolean>;
	waitUntilReady?(): Promise<boolean>;
}

type RuntimeStatusPayload = RuntimeStatusSummary;
const RUNTIME_ENGINE_ENV_HELP = RUNTIME_ENGINE_MODES.join(", ");
const START_LOG_TAIL_LINES = 40;

interface RuntimeStartDiagnostics {
	logPath?: string;
	logTail?: string[];
}

interface RuntimeDiagnosticRecovery {
	nextCommands?: string[];
	recommendations?: {
		diagnostic: string;
		severity: "failure" | "warning" | "info";
		summary: string;
		action: string;
		command?: string;
	}[];
	handoffs?: {
		interactive: string;
		inspectCurrent: string;
		inspectProviders: string;
		localNoKeyModel: string;
		openExternalLinks: string;
	};
}

type RuntimeJsonPayload<TExtra extends object = object> = RuntimeStatusPayload &
	TExtra & {
		command: "runtime";
		operation: "status" | "ensure" | "start";
		ok: boolean;
		nextAction: string | null;
		nextActions: string[];
		nextCommand: string | null;
		nextCommands: string[];
	};

function defaultDeps(): RuntimeCommandDeps {
	return {
		repoRoot: findRepoRoot,
		readEngine: readTractorEngineMode,
		readAutostart: readAutostartMode,
		readSidecarUrl: resolveRuntimeSidecarUrl,
		resolveRuntime: resolveLaunchRuntime,
		probeReadiness: () => probeRuntimeReadiness(300),
		waitUntilReady: waitForRuntimeReady,
	};
}

function runtimeSidecarProbeSummary(
	probe: RuntimeReadinessProbe,
): RuntimeSidecarProbeSummary {
	return {
		url: probe.url,
		ready: probe.ready,
		...(probe.status !== undefined ? { status: probe.status } : {}),
		...(probe.error ? { error: probe.error } : {}),
		...(probe.timedOut ? { timedOut: true } : {}),
	};
}

async function runtimeStatusPayload(deps: RuntimeCommandDeps): Promise<RuntimeStatusPayload> {
	const configuredEngine = deps.readEngine();
	const autostart = deps.readAutostart();
	const sidecar = deps.readSidecarUrl?.() ?? resolveRuntimeSidecarUrl();
	const repoRoot = deps.repoRoot();
	const readinessProbe = deps.probeReadiness ? await deps.probeReadiness() : undefined;
	const ready = readinessProbe?.ready ?? (deps.probeReady ? await deps.probeReady() : undefined);
	const sidecarProbe = readinessProbe
		? runtimeSidecarProbeSummary(readinessProbe)
		: undefined;
	try {
		const selection = deps.resolveRuntime(repoRoot, configuredEngine);
		return {
			configuredEngine,
			activeEngine: selection.activeEngine,
			autostart,
			reason: selection.reason,
			sidecarUrl: sidecar.value,
			sidecarUrlSource: sidecar.source,
			...(sidecarProbe ? { sidecarProbe } : {}),
			ready,
			startCommand: resolveRuntimeLaunchCommand(
				repoRoot,
				selection.activeEngine,
			).display,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			configuredEngine,
			activeEngine: "unknown",
			autostart,
			reason: "configured-rust-missing-binary",
			sidecarUrl: sidecar.value,
			sidecarUrlSource: sidecar.source,
			...(sidecarProbe ? { sidecarProbe } : {}),
			ready,
			issue: message,
		};
	}
}

function runtimeNextCommands(payload: RuntimeStatusPayload): string[] {
	if (payload.activeEngine === "unknown") {
		return [
			RUNTIME_ENGINE_AUTO_COMMAND,
			RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			RUNTIME_DOCTOR_NEXT_COMMAND,
		];
	}
	if (payload.ready === false) {
		return [RUNTIME_ENSURE_WAIT_NEXT_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND];
	}
	if (payload.ready === true) {
		return [RESUME_JSON_COMMAND];
	}
	return [];
}

function buildRuntimeJsonPayload<TExtra extends object = object>(
	payload: RuntimeStatusPayload,
	extra?: TExtra,
	nextCommandsOverride?: string[],
	operation: RuntimeJsonPayload["operation"] = "status",
): RuntimeJsonPayload<TExtra> {
	const nextCommands = nextCommandsOverride ?? runtimeNextCommands(payload);
	const nextActions = runtimeNextActions(nextCommands, extra);
	return {
		command: "runtime",
		operation,
		...payload,
		...(extra ?? {}),
		ok: runtimePayloadOk(payload),
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	} as RuntimeJsonPayload<TExtra>;
}

function runtimePayloadOk(payload: RuntimeStatusPayload): boolean {
	return payload.activeEngine !== "unknown" && !payload.issue && payload.ready !== false;
}

function runtimeNextActions<TExtra extends object = object>(
	nextCommands: string[],
	extra?: TExtra,
): string[] {
	const recommendationAction = firstRecommendationAction(extra);
	return recommendationAction
		? [recommendationAction]
		: nextCommands.length > 0
			? [nextCommands[0]!]
			: [];
}

function firstRecommendationAction(extra?: object): string | null {
	if (!extra || typeof extra !== "object") return null;
	const recommendations = (extra as { recommendations?: unknown }).recommendations;
	if (!Array.isArray(recommendations)) return null;
	for (const recommendation of recommendations) {
		if (!recommendation || typeof recommendation !== "object") continue;
		const action = (recommendation as { action?: unknown }).action;
		if (typeof action === "string" && action.trim().length > 0) {
			return action.trim();
		}
	}
	return null;
}

function runtimeStartDiagnostics(
	command?: RuntimeLaunchCommand,
): RuntimeStartDiagnostics | undefined {
	if (!command?.logPath) return undefined;
	if (!existsSync(command.logPath)) return { logPath: command.logPath };
	const content = readFileSync(command.logPath, "utf-8");
	const logTail = content
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.slice(-START_LOG_TAIL_LINES);
	return {
		logPath: command.logPath,
		...(logTail.length > 0 ? { logTail } : {}),
	};
}

function runtimeStartDiagnosticRecovery(
	diagnostics?: RuntimeStartDiagnostics,
): RuntimeDiagnosticRecovery {
	const logText = diagnostics?.logTail?.join("\n") ?? "";
	if (
		logText.includes("API_KEY is not set") ||
		logText.includes("Configure keys with: refarm sow")
	) {
		return {
			nextCommands: [
				LOCAL_MODEL_JSON_COMMAND,
				MODEL_CURRENT_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				SOW_JSON_COMMAND,
				OPERATOR_LINKS_CONFIG_COMMAND,
			],
			recommendations: [
				{
					diagnostic: "model-credentials-missing",
					severity: "failure",
					summary: "The runtime startup log reports missing model credentials.",
					action: "Inspect credential handoffs and configure a usable model route.",
					command: LOCAL_MODEL_JSON_COMMAND,
				},
			],
			handoffs: {
				interactive: SOW_INTERACTIVE_COMMAND,
				inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
				inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
				localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
				openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
			},
		};
	}
	if (diagnostics?.logPath) {
		return {
			nextCommands: [
				RUNTIME_START_DRY_RUN_JSON_COMMAND,
				RUNTIME_STATUS_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			recommendations: [
				{
					diagnostic: "runtime-start-no-readiness",
					severity: "failure",
					summary: "The runtime was started but did not become ready, and the startup log has no actionable output.",
					action: "Inspect the resolved runtime launch command before retrying readiness recovery.",
					command: RUNTIME_START_DRY_RUN_JSON_COMMAND,
				},
			],
		};
	}
	return {};
}

function printRuntimeStatus(payload: RuntimeStatusPayload): void {
	console.log(chalk.bold("Refarm runtime"));
	console.log(`  configured: ${payload.configuredEngine}`);
	console.log(`  active:     ${payload.activeEngine}`);
	const readyLabel =
		payload.ready === undefined ? "unknown" : payload.ready ? "yes" : "no";
	console.log(`  ready:      ${readyLabel}`);
	console.log(`  autostart:  ${payload.autostart}`);
	if (payload.sidecarUrl) {
		console.log(`  sidecar:    ${payload.sidecarUrl}`);
	}
	console.log(`  reason:     ${payload.reason}`);
	if (payload.startCommand) {
		console.log(`  start:      ${payload.startCommand}`);
	}
	if (payload.issue) {
		console.log(chalk.yellow(`  issue:      ${payload.issue}`));
	}
	console.log("");
	console.log(chalk.dim(`  Select engine:  ${RUNTIME_ENGINE_AUTO_COMMAND}`));
	console.log(chalk.dim(`  Start runtime:  ${RUNTIME_START_COMMAND}`));
	console.log(chalk.dim(`  Autostart:      ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.log(chalk.dim("  Full status:    refarm status --json"));
}

async function resolveRuntimeStartCommand(deps: RuntimeCommandDeps): Promise<{
	payload: RuntimeStatusPayload;
	command?: RuntimeLaunchCommand;
}> {
	const repoRoot = deps.repoRoot();
	const payload = await runtimeStatusPayload(deps);
	if (payload.activeEngine === "unknown") {
		return { payload };
	}
	return {
		payload,
		command: resolveRuntimeLaunchCommand(repoRoot, payload.activeEngine),
	};
}

export function createRuntimeCommand(
	deps: RuntimeCommandDeps = defaultDeps(),
): Command {
	return new Command("runtime")
		.description("Inspect Refarm runtime engine selection")
		.option("--json", "Output machine-readable JSON")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm runtime
  $ ${RUNTIME_STATUS_COMMAND}
  $ ${RUNTIME_START_COMMAND}
  $ ${RUNTIME_START_WAIT_COMMAND}
  $ ${RUNTIME_ENSURE_WAIT_COMMAND}
  $ ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}
  $ refarm runtime start --dry-run
  $ refarm runtime --json
  $ refarm runtime status --json
  $ refarm config set tractor.engine rust
  $ ${TRACTOR_ENGINE_ENV_VAR}=ts refarm runtime
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}

Notes:
  tractor.engine=auto prefers the Rust Tractor daemon when its local binary is
  available, and otherwise falls back to the TypeScript Farmhand runtime.
  ${TRACTOR_ENGINE_ENV_VAR} can be ${RUNTIME_ENGINE_ENV_HELP} for one-shot selection.
  runtime.autostart controls whether CLI flows ask before starting the selected
  runtime, start it automatically, or never start it.
`,
		)
		.addCommand(
			new Command("status")
				.description("Show selected runtime engine, readiness, and start command")
				.option("--json", "Output machine-readable JSON")
				.addHelpText(
					"after",
					`

Examples:
  $ ${RUNTIME_STATUS_COMMAND}
  $ refarm runtime status --json
  $ ${RUNTIME_START_WAIT_COMMAND}

Notes:
  This is the explicit form of bare refarm runtime. It probes whether the local
  runtime sidecar is responding and prints the selected start command.
`,
				)
				.action(async (opts: { json?: boolean }, subcommand: Command) => {
					const json = opts.json || subcommand.parent?.opts<{ json?: boolean }>().json;
					const payload = await runtimeStatusPayload(deps);
					if (json) {
						printJson(buildRuntimeJsonPayload(payload));
						return;
					}
					printRuntimeStatus(payload);
				}),
		)
		.addCommand(
			new Command("ensure")
				.description("Start the selected runtime only when it is not ready")
				.option("--wait", "Wait until the local runtime sidecar responds")
				.option("--json", "Output machine-readable JSON")
				.option("--next-command", "Print only the first executable recovery command")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm runtime ensure
  $ ${RUNTIME_ENSURE_WAIT_COMMAND}
  $ refarm runtime ensure --wait --json
  $ ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}

Notes:
  ensure is idempotent: when the runtime is already ready it reports success
  without spawning another process. When it is not ready, it starts the selected
  runtime using the same engine selection as refarm runtime start.
`,
				)
				.action(async (
					opts: { wait?: boolean; json?: boolean; nextCommand?: boolean },
					subcommand: Command,
				) => {
					const json = opts.json || subcommand.parent?.opts<{ json?: boolean }>().json;
					const { payload, command } = await resolveRuntimeStartCommand(deps);
					if (payload.ready === true) {
						if (opts.nextCommand) return;
						if (json) {
							printJson(buildRuntimeJsonPayload(payload, {
								ensured: true,
								started: false,
							}, undefined, "ensure"));
							return;
						}
						console.log(chalk.green("Runtime already ready."));
						return;
					}

					if (!command) {
						if (opts.nextCommand) {
							const [nextCommand] = buildRuntimeJsonPayload(payload, {
								ensured: false,
								started: false,
							}, undefined, "ensure").nextCommands;
							if (nextCommand) console.log(nextCommand);
							process.exitCode = 1;
							return;
						}
						if (json) {
							printJson(buildRuntimeJsonPayload(payload, {
								ensured: false,
								started: false,
							}, undefined, "ensure"));
							process.exitCode = 1;
							return;
						}
						console.error(chalk.red("✗  Cannot ensure Refarm runtime."));
						if (payload.issue) console.error(chalk.dim(`   ${payload.issue}`));
						process.exitCode = 1;
						return;
					}

					(deps.startRuntime ?? startRuntimeProcess)(command);
					if (opts.wait) {
						const ready = await (deps.waitUntilReady ?? waitForRuntimeReady)();
						const diagnostics = ready
							? undefined
							: runtimeStartDiagnostics(command);
						const recovery = runtimeStartDiagnosticRecovery(diagnostics);
						if (opts.nextCommand) {
							const [nextCommand] = buildRuntimeJsonPayload({ ...payload, ready }, {
								launchCommand: command,
								ensured: ready,
								started: true,
								...(diagnostics ? { diagnostics } : {}),
								...(recovery.recommendations ? { recommendations: recovery.recommendations } : {}),
								...(recovery.handoffs ? { handoffs: recovery.handoffs } : {}),
							}, recovery.nextCommands, "ensure").nextCommands;
							if (nextCommand) console.log(nextCommand);
							if (!ready) process.exitCode = 1;
							return;
						}
						if (json) {
							printJson(buildRuntimeJsonPayload({ ...payload, ready }, {
								launchCommand: command,
								ensured: ready,
								started: true,
								...(diagnostics ? { diagnostics } : {}),
								...(recovery.recommendations ? { recommendations: recovery.recommendations } : {}),
								...(recovery.handoffs ? { handoffs: recovery.handoffs } : {}),
							}, recovery.nextCommands, "ensure"));
							if (!ready) process.exitCode = 1;
							return;
						}
						if (ready) {
							console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
							console.log(chalk.dim(`  command: ${command.display}`));
							console.log(chalk.green("Runtime ready."));
							return;
						}
						console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
						console.log(chalk.dim(`  command: ${command.display}`));
						console.error(chalk.red("Runtime did not become ready before timeout."));
						console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
						process.exitCode = 1;
						return;
					}

					if (opts.nextCommand) {
						const [nextCommand] = buildRuntimeJsonPayload(payload, {
							launchCommand: command,
							ensured: false,
							started: true,
						}, undefined, "ensure").nextCommands;
						if (nextCommand) console.log(nextCommand);
						return;
					}
					if (json) {
						printJson(buildRuntimeJsonPayload(payload, {
							launchCommand: command,
							ensured: false,
							started: true,
						}, undefined, "ensure"));
						return;
					}
					console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
					console.log(chalk.dim(`  command: ${command.display}`));
				}),
		)
		.addCommand(
			new Command("start")
				.description("Start the selected Refarm runtime in the background")
				.option("--dry-run", "Print the resolved start command without executing it")
				.option("--wait", "Wait until the local runtime sidecar responds")
				.option("--json", "Output machine-readable JSON")
				.addHelpText(
					"after",
					`

Examples:
  $ ${RUNTIME_START_COMMAND}
  $ ${RUNTIME_START_WAIT_COMMAND}
  $ refarm runtime start --dry-run
  $ ${TRACTOR_ENGINE_ENV_VAR}=rust refarm runtime start

Notes:
  This uses the same engine selection as refarm ask/session autostart.
  tractor.engine=auto prefers Rust Tractor when its local binary is available.
`,
				)
				.action(async (
					opts: { dryRun?: boolean; wait?: boolean; json?: boolean },
					subcommand: Command,
				) => {
					const json = opts.json || subcommand.parent?.opts<{ json?: boolean }>().json;
					const { payload, command } = await resolveRuntimeStartCommand(deps);
					if (!command) {
						if (json) {
							printJson(buildRuntimeJsonPayload(payload, { started: false }, undefined, "start"));
							process.exitCode = 1;
							return;
						}
						console.error(chalk.red("✗  Cannot start Refarm runtime."));
						if (payload.issue) console.error(chalk.dim(`   ${payload.issue}`));
						process.exitCode = 1;
						return;
					}

					if (opts.dryRun) {
						if (json) {
							printJson(buildRuntimeJsonPayload(payload, { launchCommand: command, dryRun: true }, undefined, "start"));
							return;
						}
						console.log(command.display);
						return;
					}

					(deps.startRuntime ?? startRuntimeProcess)(command);
					if (opts.wait) {
						const ready = await (deps.waitUntilReady ?? waitForRuntimeReady)();
						if (json) {
							const diagnostics = ready
								? undefined
								: runtimeStartDiagnostics(command);
							const recovery = runtimeStartDiagnosticRecovery(diagnostics);
							printJson(buildRuntimeJsonPayload({ ...payload, ready }, {
								launchCommand: command,
								started: true,
								...(diagnostics ? { diagnostics } : {}),
								...(recovery.recommendations ? { recommendations: recovery.recommendations } : {}),
								...(recovery.handoffs ? { handoffs: recovery.handoffs } : {}),
							}, recovery.nextCommands, "start"));
							if (!ready) process.exitCode = 1;
							return;
						}
						if (ready) {
							console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
							console.log(chalk.dim(`  command: ${command.display}`));
							console.log(chalk.green("Runtime ready."));
							return;
						}
						console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
						console.log(chalk.dim(`  command: ${command.display}`));
						console.error(chalk.red("Runtime did not become ready before timeout."));
						console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
						process.exitCode = 1;
						return;
					}
					if (json) {
						printJson(buildRuntimeJsonPayload(payload, { launchCommand: command, started: true }, undefined, "start"));
						return;
					}
					console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
					console.log(chalk.dim(`  command: ${command.display}`));
				}),
		)
		.action(async (opts: { json?: boolean }) => {
			const payload = await runtimeStatusPayload(deps);
			if (opts.json) {
				printJson(buildRuntimeJsonPayload(payload));
				return;
			}
			printRuntimeStatus(payload);
		});
}

export const runtimeCommand = createRuntimeCommand();
