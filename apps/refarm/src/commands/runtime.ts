import { printJson } from "@refarm.dev/cli/json-output";
import {
	RUNTIME_ENGINE_MODES,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { Command } from "commander";
import {
	resolveRuntimeSidecarUrl, TRACTOR_ENGINE_ENV_VAR,
} from "../utils/runtime-config.js";
import {
	startRuntimeProcess,
	type RuntimeLaunchCommand
} from "./runtime-launcher.js";
import {
	probeRuntimeLiveness,
	waitForRuntimeReady,
	type RuntimeReadinessProbe
} from "./runtime-readiness.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND
} from "./runtime-recovery.js";
import {
	buildRuntimeJsonPayload,
	printRuntimeStatus,
	resolveRuntimeStartCommand,
	runtimeStartDiagnosticRecovery,
	runtimeStartDiagnostics,
	runtimeStatusPayload,
} from "./runtime-status.js";
import {
	buildRuntimeStopJsonPayload,
	RUNTIME_STOP_JSON_COMMAND,
	stopRuntimeProcess,
	type RuntimeStopResult,
} from "./runtime-stop.js";
import {
	findRepoRoot,
	readAutostartModeAsync,
	readTractorEngineModeAsync,
	resolveLaunchRuntime,
	type AutostartMode,
	type LaunchRuntimeSelection,
	type TractorEngineMode,
} from "./session-launch.js";

export interface RuntimeCommandDeps {
	repoRoot(): string;
	// Widened to allow the node-aware async readers; the sole consumers await them
	// (runtime-status.ts), so a Promise return ripples nowhere else.
	readEngine(): TractorEngineMode | Promise<TractorEngineMode>;
	readAutostart(): AutostartMode | Promise<AutostartMode>;
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

const RUNTIME_ENGINE_ENV_HELP = RUNTIME_ENGINE_MODES.join(", ");

function defaultDeps(): RuntimeCommandDeps {
	return {
		repoRoot: findRepoRoot,
		readEngine: readTractorEngineModeAsync,
		readAutostart: readAutostartModeAsync,
		readSidecarUrl: resolveRuntimeSidecarUrl,
		resolveRuntime: resolveLaunchRuntime,
		probeReadiness: () => probeRuntimeLiveness(),
		waitUntilReady: waitForRuntimeReady,
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
