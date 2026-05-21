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

interface RuntimeCommandDeps {
	repoRoot(): string;
	readEngine(): TractorEngineMode;
	readAutostart(): AutostartMode;
	resolveRuntime(
		repoRoot: string,
		configuredEngine: TractorEngineMode,
	): LaunchRuntimeSelection;
	startRuntime?(command: RuntimeLaunchCommand): void;
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
	};
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
				.option("--json", "Output machine-readable JSON")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm runtime start
  $ refarm runtime start --dry-run
  $ REFARM_TRACTOR_ENGINE=rust refarm runtime start

Notes:
  This uses the same engine selection as refarm ask/session autostart.
  tractor.engine=auto prefers Rust Tractor when its local binary is available.
`,
				)
				.action((opts: { dryRun?: boolean; json?: boolean }, subcommand: Command) => {
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
