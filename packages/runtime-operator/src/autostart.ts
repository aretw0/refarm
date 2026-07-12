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

/** The honest three-way result of waiting for the daemon (mirrors runtime-operator's
 * RuntimeWaitStatus). When an app injects `probeRuntimeUntilOutcome`, a timeout can be
 * narrated as "still starting" (alive) vs "failed to start" (dead) instead of one scary
 * "timed out". */
export type AutostartWaitStatus = "ready" | "timed-out-alive" | "timed-out-dead";
export interface AutostartWaitOutcome {
	ready: boolean;
	status: AutostartWaitStatus;
	elapsedMs?: number;
}

/** A surface-neutral "work is happening" reporter, injected so runtime-operator stays
 * free of the activity package. The app backs this with `withActivity`/an ActivitySink,
 * so the SAME boot-progress signal that lights the CLI spinner also reaches the TUI and
 * (via a daemon bridge) any remote surface. `begin(label)` returns a `done(ok)` to close
 * the unit — the machine calls it around the readiness wait, the silent gap the operator
 * had no visibility into. */
export type AutostartActivityReporter = (label: string) => (ok: boolean) => void;

export interface AutoStartRuntimeDeps {
	operator: OperatorChannel;
	/** The resolved autostart mode. If absent, the machine treats it as "ask". */
	mode?: AutostartMode;
	/** Start the daemon (the app wires its spawn). */
	spawnRuntime(repoRoot: string): void;
	/** Poll until the daemon is ready (or a timeout). Legacy boolean form. */
	probeRuntimeUntilReady(): Promise<boolean>;
	/** Poll until ready, returning WHY it stopped — lets a timeout distinguish a daemon
	 * that is still booting from one that never came up. Preferred over the boolean form
	 * when the app can provide it; falls back to `probeRuntimeUntilReady` otherwise. */
	probeRuntimeUntilOutcome?(): Promise<AutostartWaitOutcome>;
	/** Optional "working" signal around the boot wait — surfaces show a spinner/pill while
	 * the daemon comes up. No-op if absent. */
	activity?: AutostartActivityReporter;
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
	// Wrap the readiness wait in the "working" signal so surfaces show progress during the
	// otherwise-silent gap between "Starting…" and ready. The reporter is optional and the
	// runtime label is engine-aware ("Starting Rust Tractor").
	const runtimeForActivity = deps.resolveRuntime?.(repoRoot);
	const activityLabel = `Starting ${
		runtimeForActivity ? vocab.engineLabel(runtimeForActivity.activeEngine) : "runtime"
	}`;
	const finishActivity = deps.activity?.(activityLabel);
	let outcome: AutostartWaitOutcome = { ready: false, status: "timed-out-dead" };
	try {
		// Prefer the outcome-returning probe (honest timeout narration); fall back to the
		// boolean form, treating a non-ready boolean as an unknown-liveness timeout.
		outcome = deps.probeRuntimeUntilOutcome
			? await deps.probeRuntimeUntilOutcome()
			: {
					ready: await deps.probeRuntimeUntilReady(),
					status: "timed-out-alive",
				};
	} finally {
		// Close the activity EXACTLY once — ok iff the daemon became ready (a throw or a
		// timeout closes it as not-ok so the spinner never hangs).
		finishActivity?.(outcome.ready);
	}
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (outcome.ready) {
		process.stdout.write("  " + chalk.green("✓ Ready") + chalk.dim(` (${elapsed}s)`) + "\n\n");
		return true;
	}

	// A timeout is NOT automatically a failure. If the daemon was reaching back (alive but
	// still booting), say so plainly — the operator can keep waiting or re-run — instead of
	// the old scary "✗ Timed out" that lied when the runtime had actually come up.
	if (outcome.status === "timed-out-alive") {
		process.stdout.write(
			"  " +
				chalk.yellow("⧗ Still starting") +
				chalk.dim(` (${elapsed}s — the daemon is up but not ready yet)`) +
				"\n",
		);
		console.error(chalk.dim(`   Check again:  ${vocab.ensureCommand}`));
		console.error(chalk.dim(`   Diagnose:     ${vocab.doctorCommand}`));
		return false;
	}

	process.stdout.write("  " + chalk.red("✗ Failed to start") + "\n");
	console.error(
		chalk.dim(`   Run \`${vocab.doctorNextActionCommand}\` for the next recovery action.`),
	);
	console.error(chalk.dim(`   Run \`${vocab.doctorCommand}\` for diagnostics.`));
	for (const line of runtimeStartHelpLines(repoRoot)) {
		console.error(chalk.dim(`   ${line.replace("start:", "fallback:")}`));
	}
	return false;
}
