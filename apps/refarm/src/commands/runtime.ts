import { runLaunchProcessSync } from "@refarm.dev/cli/launch-process";
import {
	RUNTIME_ENGINE_MODES,
	type RuntimeSidecarProbeSummary,
	type RuntimeStatusSummary,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
	resolveRuntimeSidecarUrl,
	TRACTOR_ENGINE_ENV_VAR,
} from "../utils/runtime-config.js";
import { refarmCommand } from "./command-handoff.js";
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
	stopRuntime?(repoRoot: string): RuntimeStopResult;
	probeReadiness?(): Promise<RuntimeReadinessProbe>;
	probeReady?(): Promise<boolean>;
	waitUntilReady?(): Promise<boolean>;
}

type RuntimeStatusPayload = RuntimeStatusSummary;
interface RuntimeStopResult {
	ok: boolean;
	stopped: boolean;
	alreadyStopped?: boolean;
	pid?: number;
	pidFile: string;
	targets?: RuntimeStopTargetResult[];
	message?: string;
}

interface RuntimeStopTargetResult {
	name: "tractor" | "farmhand";
	ok: boolean;
	stopped: boolean;
	alreadyStopped?: boolean;
	pid?: number;
	pidFile: string;
	source?: "pid-file" | "process-scan" | "port-scan";
	orphan?: boolean;
	message?: string;
}
const RUNTIME_ENGINE_ENV_HELP = RUNTIME_ENGINE_MODES.join(", ");
const RUNTIME_STOP_JSON_COMMAND = refarmCommand(["runtime", "stop", "--json"]);
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
		operation: "status" | "ensure" | "start" | "restart";
		ok: boolean;
		nextAction: string | null;
		nextActions: string[];
		nextCommand: string | null;
		nextCommands: string[];
	};

type RuntimeStopJsonPayload = RuntimeStopResult & {
	command: "runtime";
	operation: "stop";
	nextAction: null;
	nextActions: [];
	nextCommand: null;
	nextCommands: [];
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

function procCmdline(pid: number): string[] | null {
	if (process.platform !== "linux") return null;
	const procRoot = process.env.REFARM_PROC_ROOT ?? "/proc";
	try {
		return parseProcCmdline(readFileSync(join(procRoot, String(pid), "cmdline"), "utf-8"));
	} catch {
		return null;
	}
}

function isFarmhandProcess(args: string[]): boolean {
	return args.some((arg) => arg.includes("farmhand"));
}

function runtimePidMatchesTarget(
	name: RuntimeStopTargetResult["name"],
	pid: number,
): boolean | null {
	const args = procCmdline(pid);
	if (!args) return null;
	if (name === "tractor") return args.some(isTractorArg);
	return isFarmhandProcess(args);
}

function stopRuntimeTarget(
	name: RuntimeStopTargetResult["name"],
	pidFile: string,
): RuntimeStopTargetResult {
	if (!existsSync(pidFile)) {
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pidFile,
			source: "pid-file",
			message: `No ${name} PID file found.`,
		};
	}

	const raw = readFileSync(pidFile, "utf-8").trim();
	const pid = Number.parseInt(raw, 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; the invalid PID is the primary error.
		}
		return {
			name,
			ok: false,
			stopped: false,
			pidFile,
			source: "pid-file",
			message: `Invalid ${name} PID in ${pidFile}: ${raw}`,
		};
	}

	try {
		process.kill(pid, 0);
	} catch {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; stale PID is already handled.
		}
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source: "pid-file",
			message: `${name} process was not running; cleaned PID file.`,
		};
	}

	if (runtimePidMatchesTarget(name, pid) === false) {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; mismatched PID is already handled.
		}
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source: "pid-file",
			message: `${name} PID file pointed at a different process; cleaned PID file.`,
		};
	}

	try {
		process.kill(pid, "SIGTERM");
		unlinkSync(pidFile);
		return {
			name,
			ok: true,
			stopped: true,
			pid,
			pidFile,
			source: "pid-file",
		};
	} catch (error) {
		return {
			name,
			ok: false,
			stopped: false,
			pid,
			pidFile,
			source: "pid-file",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseProcCmdline(raw: string): string[] {
	return raw.split("\0").filter((part) => part.length > 0);
}

function isTractorArg(arg: string): boolean {
	const normalized = arg.replace(/\\/g, "/");
	return normalized === "tractor" || normalized.endsWith("/tractor");
}

function argValue(args: string[], name: string): string | null {
	const index = args.indexOf(name);
	if (index >= 0) return args[index + 1] ?? null;
	const prefix = `${name}=`;
	const value = args.find((arg) => arg.startsWith(prefix));
	return value ? value.slice(prefix.length) : null;
}

function hasExplicitRuntimePorts(args: string[]): boolean {
	return argValue(args, "--port") !== null || argValue(args, "--http-port") !== null;
}

function tractorProcessBelongsToRepo(args: string[], repoRoot: string): boolean {
	const normalizedRepoRoot = repoRoot.replace(/\\/g, "/");
	return args.some((arg) => arg.replace(/\\/g, "/").startsWith(normalizedRepoRoot));
}

function findDefaultPortTractorProcesses(repoRoot: string): number[] {
	if (process.platform !== "linux") return [];
	const procRoot = process.env.REFARM_PROC_ROOT ?? "/proc";
	let entries: string[];
	try {
		entries = readdirSync(procRoot);
	} catch {
		return [];
	}
	const currentPid = process.pid;
	const pids: number[] = [];
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number.parseInt(entry, 10);
		if (!Number.isFinite(pid) || pid <= 0 || pid === currentPid) continue;
		let args: string[];
		try {
			args = parseProcCmdline(readFileSync(join(procRoot, entry, "cmdline"), "utf-8"));
		} catch {
			continue;
		}
		if (args.length === 0 || !isTractorArg(args[0]!)) continue;
		if (hasExplicitRuntimePorts(args)) continue;
		if (!tractorProcessBelongsToRepo(args, repoRoot)) continue;
		pids.push(pid);
	}
	return pids;
}

function parseDefaultPortRuntimeSocketProcesses(output: string): number[] {
	const pids = new Set<number>();
	for (const line of output.split(/\r?\n/)) {
		if (!/:(42000|42001)\b/.test(line)) continue;
		if (!line.includes('"tractor"') && !line.includes('"farmhand"')) continue;
		for (const match of line.matchAll(/\bpid=(\d+)\b/g)) {
			const pid = Number.parseInt(match[1]!, 10);
			if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
				pids.add(pid);
			}
		}
	}
	return [...pids];
}

function findDefaultPortRuntimeSocketProcesses(): number[] {
	const configuredOutput = process.env.REFARM_SS_OUTPUT;
	if (configuredOutput !== undefined) {
		return parseDefaultPortRuntimeSocketProcesses(configuredOutput);
	}
	if (process.env.NODE_ENV === "test" || process.env.VITEST) return [];
	if (process.platform !== "linux") return [];
	const result = runLaunchProcessSync(
		{
			command: "ss",
			args: ["-tlnp"],
			display: "ss -tlnp",
		},
		{ capture: true },
	);
	if (result.exitCode !== 0) return [];
	return parseDefaultPortRuntimeSocketProcesses(result.stdout ?? "");
}

function stopRuntimePid(
	name: RuntimeStopTargetResult["name"],
	pid: number,
	pidFile: string,
	source: RuntimeStopTargetResult["source"],
	orphan = false,
): RuntimeStopTargetResult {
	try {
		process.kill(pid, 0);
	} catch {
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
			message: `${name} process was not running.`,
		};
	}
	try {
		process.kill(pid, "SIGTERM");
		return {
			name,
			ok: true,
			stopped: true,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
		};
	} catch (error) {
		return {
			name,
			ok: false,
			stopped: false,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function stopRuntimeProcess(repoRoot: string): RuntimeStopResult {
	const tractorPidFile = join(repoRoot, ".refarm", "tractor.pid");
	const farmhandPidFile = join(repoRoot, ".refarm", "farmhand.pid");
	const targets = [
		stopRuntimeTarget("tractor", tractorPidFile),
		stopRuntimeTarget("farmhand", farmhandPidFile),
	];
	const knownPids = new Set(
		targets.flatMap((target) => (target.pid ? [target.pid] : [])),
	);
	for (const pid of findDefaultPortTractorProcesses(repoRoot)) {
		if (knownPids.has(pid)) continue;
		targets.push(stopRuntimePid("tractor", pid, tractorPidFile, "process-scan", true));
		knownPids.add(pid);
	}
	for (const pid of findDefaultPortRuntimeSocketProcesses()) {
		if (knownPids.has(pid)) continue;
		targets.push(stopRuntimePid("tractor", pid, tractorPidFile, "port-scan", true));
		knownPids.add(pid);
	}
	const failed = targets.find((target) => !target.ok);
	const stopped = targets.filter((target) => target.stopped);
	const primary = failed ?? stopped[0] ?? targets[0]!;
	return {
		ok: !failed,
		stopped: stopped.length > 0,
		alreadyStopped: stopped.length === 0 && !failed,
		...(stopped.length === 1 && stopped[0]?.pid ? { pid: stopped[0].pid } : {}),
		pidFile: primary.pidFile,
		targets,
		message: failed
			? failed.message
			: stopped.length > 0
				? `Stopped ${stopped.map((target) => target.name).join(", ")} runtime process${stopped.length === 1 ? "" : "es"}.`
				: "No runtime PID files found.",
	};
}

function buildRuntimeStopJsonPayload(
	result: RuntimeStopResult,
): RuntimeStopJsonPayload {
	return {
		command: "runtime",
		operation: "stop",
		...result,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
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
				SOW_INTERACTIVE_COMMAND,
				MODEL_CURRENT_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				SOW_JSON_COMMAND,
				LOCAL_MODEL_JSON_COMMAND,
				OPERATOR_LINKS_CONFIG_COMMAND,
			],
			recommendations: [
				{
					diagnostic: "model-credentials-missing",
					severity: "failure",
					summary: "The runtime startup log reports missing model credentials.",
					action: "Inspect credential handoffs and configure a usable model route.",
					command: SOW_INTERACTIVE_COMMAND,
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
  $ refarm runtime stop
  $ refarm runtime restart --wait
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
			new Command("stop")
				.description("Stop the selected Refarm runtime sidecar")
				.option("--json", "Output machine-readable JSON")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm runtime stop
  $ refarm runtime stop --json

Notes:
  This stops the local runtime process tracked by the selected workspace.
`,
				)
				.action((opts: { json?: boolean }, subcommand: Command) => {
					const json = opts.json || subcommand.parent?.opts<{ json?: boolean }>().json;
					const result = (deps.stopRuntime ?? stopRuntimeProcess)(deps.repoRoot());
					if (json) {
						printJson(buildRuntimeStopJsonPayload(result));
						if (!result.ok) process.exitCode = 1;
						return;
					}
					if (result.ok && result.stopped) {
						console.log(chalk.green(result.message ?? "Runtime stopped."));
						return;
					}
					if (result.ok) {
						console.log(chalk.dim(result.message ?? "Runtime was not running."));
						return;
					}
					console.error(chalk.red(`✗  ${result.message ?? "Runtime stop failed."}`));
					process.exitCode = 1;
				}),
		)
		.addCommand(
			new Command("restart")
				.description("Restart the selected Refarm runtime sidecar")
				.option("--wait", "Wait until the local runtime sidecar responds")
				.option("--json", "Output machine-readable JSON")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm runtime restart
  $ refarm runtime restart --wait
  $ refarm runtime restart --wait --json

Notes:
  restart is the explicit stop/start path used when a plugin cannot hot-reload.
`,
				)
				.action(async (
					opts: { wait?: boolean; json?: boolean },
					subcommand: Command,
				) => {
					const json = opts.json || subcommand.parent?.opts<{ json?: boolean }>().json;
					const stop = (deps.stopRuntime ?? stopRuntimeProcess)(deps.repoRoot());
					if (!stop.ok) {
						if (json) {
							printJson({
								command: "runtime",
								operation: "restart",
								ok: false,
								stop,
								nextAction: RUNTIME_STOP_JSON_COMMAND,
								nextActions: [RUNTIME_STOP_JSON_COMMAND],
								nextCommand: RUNTIME_STOP_JSON_COMMAND,
								nextCommands: [
									RUNTIME_STOP_JSON_COMMAND,
									RUNTIME_DOCTOR_NEXT_COMMAND,
								],
							});
						} else {
							console.error(chalk.red(`✗  ${stop.message ?? "Runtime stop failed."}`));
						}
						process.exitCode = 1;
						return;
					}

					const { payload, command } = await resolveRuntimeStartCommand(deps);
					if (!command) {
						if (json) {
							printJson(buildRuntimeJsonPayload(payload, {
								stop,
								started: false,
							}, undefined, "restart"));
						} else {
							console.error(chalk.red("✗  Cannot restart Refarm runtime."));
							if (payload.issue) console.error(chalk.dim(`   ${payload.issue}`));
						}
						process.exitCode = 1;
						return;
					}

					(deps.startRuntime ?? startRuntimeProcess)(command);
					const ready = opts.wait
						? await (deps.waitUntilReady ?? waitForRuntimeReady)()
						: undefined;
					if (json) {
						const diagnostics = opts.wait && ready !== true
							? runtimeStartDiagnostics(command)
							: undefined;
						const recovery = runtimeStartDiagnosticRecovery(diagnostics);
						printJson(buildRuntimeJsonPayload({
							...payload,
							...(ready !== undefined ? { ready } : {}),
						}, {
							stop,
							launchCommand: command,
							started: true,
							...(diagnostics ? { diagnostics } : {}),
							...(recovery.recommendations ? { recommendations: recovery.recommendations } : {}),
							...(recovery.handoffs ? { handoffs: recovery.handoffs } : {}),
						}, recovery.nextCommands, "restart"));
						if (opts.wait && !ready) process.exitCode = 1;
						return;
					}
					if (stop.stopped) {
						console.log(chalk.green(stop.message ?? "Stopped runtime."));
					}
					console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
					console.log(chalk.dim(`  command: ${command.display}`));
					if (opts.wait) {
						if (ready) {
							console.log(chalk.green("Runtime ready."));
						} else {
							console.error(chalk.red("Runtime did not become ready before timeout."));
							console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
							process.exitCode = 1;
						}
					}
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
