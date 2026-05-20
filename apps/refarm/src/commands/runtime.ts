import chalk from "chalk";
import { Command } from "commander";
import {
	findRepoRoot,
	readTractorEngineMode,
	resolveLaunchRuntime,
	type LaunchRuntimeEngine,
	type LaunchRuntimeSelection,
	type TractorEngineMode,
} from "./session-launch.js";

interface RuntimeCommandDeps {
	repoRoot(): string;
	readEngine(): TractorEngineMode;
	resolveRuntime(
		repoRoot: string,
		configuredEngine: TractorEngineMode,
	): LaunchRuntimeSelection;
}

interface RuntimeStatusPayload {
	configuredEngine: TractorEngineMode;
	activeEngine: LaunchRuntimeEngine | "unknown";
	reason: LaunchRuntimeSelection["reason"] | "configured-rust-missing-binary";
	issue?: string;
}

function defaultDeps(): RuntimeCommandDeps {
	return {
		repoRoot: findRepoRoot,
		readEngine: readTractorEngineMode,
		resolveRuntime: resolveLaunchRuntime,
	};
}

function runtimeStatusPayload(deps: RuntimeCommandDeps): RuntimeStatusPayload {
	const configuredEngine = deps.readEngine();
	try {
		const selection = deps.resolveRuntime(deps.repoRoot(), configuredEngine);
		return {
			configuredEngine,
			activeEngine: selection.activeEngine,
			reason: selection.reason,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			configuredEngine,
			activeEngine: "unknown",
			reason: "configured-rust-missing-binary",
			issue: message,
		};
	}
}

function printRuntimeStatus(payload: RuntimeStatusPayload): void {
	console.log(chalk.bold("Refarm runtime"));
	console.log(`  configured: ${payload.configuredEngine}`);
	console.log(`  active:     ${payload.activeEngine}`);
	console.log(`  reason:     ${payload.reason}`);
	if (payload.issue) {
		console.log(chalk.yellow(`  issue:      ${payload.issue}`));
	}
	console.log("");
	console.log(chalk.dim("  Select engine:  refarm config set tractor.engine auto"));
	console.log(chalk.dim("  Full status:    refarm status --json"));
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
  $ refarm runtime --json
  $ refarm config set tractor.engine rust

Notes:
  tractor.engine=auto prefers the Rust Tractor daemon when its local binary is
  available, and otherwise falls back to the TypeScript Farmhand runtime.
`,
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
