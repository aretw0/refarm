import type { OperatorChannel } from "@refarm.dev/prompt-contract-v1";
import chalk from "chalk";

import {
	resolveRuntimeLaunchCommand,
	runtimeStartHelpLines,
	type LaunchRuntimeEngine,
} from "./launcher.js";

/**
 * The intent-driven autostart machine: when a command needs the runtime and it isn't
 * up, this resolves the autostart mode, (optionally asks), starts the daemon, and waits
 * for readiness — announcing EVERY step on the console. No silent magic: the operator
 * always sees "runtime not running → starting X → ready/timed-out".
 *
 * It is white-label. The command strings it prints (how to ensure/start/diagnose) and
 * the engine labels are INJECTED, so `refarm` prints `refarm runtime start` and `dgk`
 * prints `dgk runtime start` from the same machine. The config-derived mode and the
 * spawn/probe are injected too (via {@link AutoStartRuntimeDeps}), so this package stays
 * storage-free and app-agnostic.
 */

export type AutostartMode = "never" | "ask" | "always";

/** The app's own vocabulary — the recovery commands and engine labels this machine
 * prints. Each app passes its own so the guidance names ITS commands, not refarm's. */
export interface AutostartVocabulary {
	ensureCommand: string;
	startCommand: string;
	doctorNextActionCommand: string;
	doctorCommand: string;
	/** Human label for an engine, e.g. "Rust Tractor" / "TypeScript Farmhand". */
	engineLabel(engine: LaunchRuntimeEngine): string;
	/** How to build the rust runtime, shown on the auto-ts fallback. Optional. */
	buildRustCommand?(repoRoot: string): string;
}

/** Which engine is active and why — the app resolves this from its config. */
export interface AutostartRuntimeSelection {
	activeEngine: LaunchRuntimeEngine;
	reason?: string;
}

export interface AutoStartRuntimeDeps {
	operator: OperatorChannel;
	/** The resolved autostart mode. If absent, the machine treats it as "ask". */
	mode?: AutostartMode;
	/** Start the daemon (the app wires its spawn). */
	spawnRuntime(repoRoot: string): void;
	/** Poll until the daemon is ready (or a timeout). */
	probeRuntimeUntilReady(): Promise<boolean>;
	/** Which engine is active (for the label + start-command display). Optional. */
	resolveRuntime?(repoRoot: string): AutostartRuntimeSelection;
}

/**
 * Start the runtime if the mode allows, narrating each step. Returns true once the
 * daemon is ready, false if it was declined, failed to start, or timed out (with
 * recovery guidance printed either way).
 */
export async function autoStartRuntime(
	repoRoot: string,
	vocab: AutostartVocabulary,
	deps: AutoStartRuntimeDeps,
): Promise<boolean> {
	const mode = deps.mode ?? "ask";

	if (mode === "never") {
		process.stderr.write(chalk.red("✗  The runtime is not running.\n"));
		console.error(chalk.dim(`   Ensure runtime:   ${vocab.ensureCommand}`));
		console.error(chalk.dim(`   Start fallback:   ${vocab.startCommand}`));
		for (const line of runtimeStartHelpLines(repoRoot)) {
			console.error(chalk.dim(`   ${line}`));
		}
		console.error(chalk.dim(`   Next action:      ${vocab.doctorNextActionCommand}`));
		console.error(chalk.dim(`   Diagnose:         ${vocab.doctorCommand}`));
		return false;
	}

	process.stderr.write(chalk.red("✗  The runtime is not running.\n\n"));

	if (mode === "ask") {
		const confirmed = await deps.operator.ask({
			type: "confirm",
			question: "   Start it now?",
			default: true,
		});
		if (!confirmed) {
			console.error(chalk.dim(`\n   Ensure later: ${vocab.ensureCommand}`));
			console.error(chalk.dim(`   Start fallback: ${vocab.startCommand}`));
			console.error(chalk.dim(`   Next action:  ${vocab.doctorNextActionCommand}`));
			console.error(chalk.dim(`   Diagnose:     ${vocab.doctorCommand}`));
			return false;
		}
	}

	try {
		const runtime = deps.resolveRuntime?.(repoRoot);
		const runtimeLabel = runtime ? vocab.engineLabel(runtime.activeEngine) : "selected runtime";
		const startCommand = runtime
			? resolveRuntimeLaunchCommand(repoRoot, runtime.activeEngine).display
			: null;
		process.stdout.write(chalk.dim(`   → Starting ${runtimeLabel}...`));
		if (runtime?.reason === "auto-ts-fallback") {
			process.stdout.write(chalk.dim(`\n   rust tractor: not built; using TypeScript fallback`));
			if (vocab.buildRustCommand) {
				process.stdout.write(chalk.dim(`\n   build rust: ${vocab.buildRustCommand(repoRoot)}`));
			}
		}
		if (startCommand) {
			process.stdout.write(chalk.dim(`\n   command: ${startCommand}\n`));
		}
		deps.spawnRuntime(repoRoot);
	} catch (error) {
		process.stdout.write("  " + chalk.red("✗ Failed") + "\n");
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.dim(`   ${message}`));
		console.error(chalk.dim(`   Next action:  ${vocab.doctorNextActionCommand}`));
		console.error(chalk.dim(`   Diagnose:  ${vocab.doctorCommand}`));
		return false;
	}

	const start = Date.now();
	const ready = await deps.probeRuntimeUntilReady();
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (ready) {
		process.stdout.write("  " + chalk.green("✓ Ready") + chalk.dim(` (${elapsed}s)`) + "\n\n");
		return true;
	}

	process.stdout.write("  " + chalk.red("✗ Timed out") + "\n");
	console.error(
		chalk.dim(`   Run \`${vocab.doctorNextActionCommand}\` for the next recovery action.`),
	);
	console.error(chalk.dim(`   Run \`${vocab.doctorCommand}\` for diagnostics.`));
	for (const line of runtimeStartHelpLines(repoRoot)) {
		console.error(chalk.dim(`   ${line.replace("start:", "fallback:")}`));
	}
	return false;
}
