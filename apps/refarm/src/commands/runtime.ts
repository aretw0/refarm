import chalk from "chalk";
import { Command } from "commander";
import {
	findRepoRoot,
	readAutostartMode,
	readTractorEngineMode,
	resolveLaunchRuntime,
	type AutostartMode,
	type LaunchRuntimeEngine,
	type LaunchRuntimeSelection,
	type TractorEngineMode,
} from "./session-launch.js";
import {
	resolveRuntimeLaunchCommand,
	startRuntimeProcess,
	type RuntimeLaunchCommand,
} from "./runtime-launcher.js";
import { sidecarUrl } from "./sidecar-url.js";

const RUNTIME_START_WAIT_TIMEOUT_MS = 10_000;
const RUNTIME_START_WAIT_POLL_INTERVAL_MS = 250;
const RUNTIME_START_PROBE_TIMEOUT_MS = 300;

interface RuntimeCommandDeps {
	repoRoot(): string;
	readEngine(): TractorEngineMode;
	readAutostart(): AutostartMode;
	resolveRuntime(
		repoRoot: string,
		configuredEngine: TractorEngineMode,
	): LaunchRuntimeSelection;
	startRuntime?(command: RuntimeLaunchCommand): void;
	waitUntilReady?(): Promise<boolean>;
}

interface RuntimeStatusPayload {
	configuredEngine: TractorEngineMode;
	activeEngine: LaunchRuntimeEngine | "unknown";
	autostart: AutostartMode;
	reason: LaunchRuntimeSelection["reason"] | "configured-rust-missing-binary";
	startCommand?: string;
	issue?: string;
}

function defaultDeps(): RuntimeCommandDeps {
	return {
		repoRoot: findRepoRoot,
		readEngine: readTractorEngineMode,
		readAutostart: readAutostartMode,
		resolveRuntime: resolveLaunchRuntime,
		waitUntilReady: waitForRuntimeReady,
	};
}

async function probeRuntime(): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const controller = new AbortController();
		timer = setTimeout(
			() => controller.abort(),
			RUNTIME_START_PROBE_TIMEOUT_MS,
		);
		const response = await fetch(sidecarUrl("/efforts/summary"), {
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function waitForRuntimeReady(): Promise<boolean> {
	const deadline = Date.now() + RUNTIME_START_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await probeRuntime()) return true;
		await new Promise((resolve) =>
			setTimeout(resolve, RUNTIME_START_WAIT_POLL_INTERVAL_MS),
		);
	}
	return false;
}

function runtimeStatusPayload(deps: RuntimeCommandDeps): RuntimeStatusPayload {
	const configuredEngine = deps.readEngine();
	const autostart = deps.readAutostart();
	const repoRoot = deps.repoRoot();
	try {
		const selection = deps.resolveRuntime(repoRoot, configuredEngine);
		return {
			configuredEngine,
			activeEngine: selection.activeEngine,
			autostart,
			reason: selection.reason,
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
			issue: message,
		};
	}
}

function printRuntimeStatus(payload: RuntimeStatusPayload): void {
	console.log(chalk.bold("Refarm runtime"));
	console.log(`  configured: ${payload.configuredEngine}`);
	console.log(`  active:     ${payload.activeEngine}`);
	console.log(`  autostart:  ${payload.autostart}`);
	console.log(`  reason:     ${payload.reason}`);
	if (payload.startCommand) {
		console.log(`  start:      ${payload.startCommand}`);
	}
	if (payload.issue) {
		console.log(chalk.yellow(`  issue:      ${payload.issue}`));
	}
	console.log("");
	console.log(chalk.dim("  Select engine:  refarm config set tractor.engine auto"));
	console.log(chalk.dim("  Start runtime:  refarm runtime start"));
	console.log(chalk.dim("  Autostart:      refarm config set runtime.autostart always"));
	console.log(chalk.dim("  Full status:    refarm status --json"));
}

function resolveRuntimeStartCommand(deps: RuntimeCommandDeps): {
	payload: RuntimeStatusPayload;
	command?: RuntimeLaunchCommand;
} {
	const repoRoot = deps.repoRoot();
	const payload = runtimeStatusPayload(deps);
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
  $ refarm runtime start
  $ refarm runtime start --wait
  $ refarm runtime start --dry-run
  $ refarm runtime --json
  $ refarm config set tractor.engine rust
  $ REFARM_TRACTOR_ENGINE=ts refarm runtime
  $ refarm config set runtime.autostart always

Notes:
  tractor.engine=auto prefers the Rust Tractor daemon when its local binary is
  available, and otherwise falls back to the TypeScript Farmhand runtime.
  REFARM_TRACTOR_ENGINE can be auto, rust, or ts for one-shot selection.
  runtime.autostart controls whether CLI flows ask before starting the selected
  runtime, start it automatically, or never start it.
`,
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
  $ refarm runtime start
  $ refarm runtime start --wait
  $ refarm runtime start --dry-run
  $ REFARM_TRACTOR_ENGINE=rust refarm runtime start

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
					const { payload, command } = resolveRuntimeStartCommand(deps);
					if (!command) {
						if (json) {
							console.log(JSON.stringify({ ...payload, started: false }, null, 2));
							return;
						}
						console.error(chalk.red("✗  Cannot start Refarm runtime."));
						if (payload.issue) console.error(chalk.dim(`   ${payload.issue}`));
						process.exitCode = 1;
						return;
					}

					if (opts.dryRun) {
						if (json) {
							console.log(
								JSON.stringify({ ...payload, command, dryRun: true }, null, 2),
							);
							return;
						}
						console.log(command.display);
						return;
					}

					(deps.startRuntime ?? startRuntimeProcess)(command);
					if (opts.wait) {
						const ready = await (deps.waitUntilReady ?? waitForRuntimeReady)();
						if (json) {
							console.log(
								JSON.stringify(
									{ ...payload, command, started: true, ready },
									null,
									2,
								),
							);
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
						console.error(chalk.dim("  Diagnose: refarm doctor"));
						process.exitCode = 1;
						return;
					}
					if (json) {
						console.log(JSON.stringify({ ...payload, command, started: true }, null, 2));
						return;
					}
					console.log(chalk.green(`Started ${payload.activeEngine} runtime.`));
					console.log(chalk.dim(`  command: ${command.display}`));
				}),
		)
		.action((opts: { json?: boolean }) => {
			const payload = runtimeStatusPayload(deps);
			if (opts.json) {
				console.log(JSON.stringify(payload, null, 2));
				return;
			}
			printRuntimeStatus(payload);
		});
}

export const runtimeCommand = createRuntimeCommand();
