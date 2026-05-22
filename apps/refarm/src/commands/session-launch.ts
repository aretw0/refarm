/**
 * Session launch policy — readiness check, auto-start, and guide output.
 * No readline REPL, no Commander. Just policy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
	type OperatorChannel,
	createStdioOperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import {
	parseRuntimeAutostartMode,
	parseRuntimeEngineMode,
	type RuntimeAutostartMode,
	type RuntimeEngineMode,
} from "@refarm.dev/runtime";
import { createPackageScriptCommand } from "./package-manager.js";
import {
	resolveRuntimeLaunchCommand,
	runtimeStartHelpLines,
	startRuntimeProcess,
} from "./runtime-launcher.js";
import {
	probeRuntimeReady,
	waitForRuntimeReady,
} from "./runtime-readiness.js";

export interface SessionReadiness {
	providerConfigured: boolean;
	runtimeRunning?: boolean;
	farmhandRunning?: boolean;
}

export type AutostartMode = RuntimeAutostartMode;
export type TractorEngineMode = RuntimeEngineMode;
export type LaunchRuntimeEngine = "rust" | "ts";

export interface LaunchRuntimeSelection {
	configuredEngine: TractorEngineMode;
	activeEngine: LaunchRuntimeEngine;
	reason: "configured-rust" | "configured-ts" | "auto-rust-available" | "auto-ts-fallback";
}

export interface LaunchDeps {
	operator: OperatorChannel;
	spawnRuntime?(repoRoot: string): void;
	probeRuntimeUntilReady?(): Promise<boolean>;
	spawnFarmhand?(repoRoot: string): void;
	probeFarmhandUntilReady?(): Promise<boolean>;
	resolveRuntime?(repoRoot: string): LaunchRuntimeSelection;
	/** How to handle runtime auto-start. Reads from config.json; default "ask". */
	autostartMode?: AutostartMode;
	/** Called when no provider is configured — returns true if provider is now ready. */
	recoverProvider?(): Promise<boolean>;
}

export function isSessionReady(r: SessionReadiness): boolean {
	return r.providerConfigured && isRuntimeRunning(r);
}

export function isRuntimeRunning(r: SessionReadiness): boolean {
	return r.runtimeRunning ?? r.farmhandRunning ?? false;
}

export function isFirstRun(): boolean {
	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return false;
		if (fs.existsSync(path.join(base, "config.json"))) return false;
		if (fs.existsSync(path.join(base, "identity.json"))) return false;
	}
	return true;
}

export async function checkSessionReadiness(): Promise<SessionReadiness> {
	const providerConfigured = detectProvider();
	const runtimeRunning = await probeRuntimeReady();
	return { providerConfigured, runtimeRunning, farmhandRunning: runtimeRunning };
}

// Exported for tests — returns dirs to search for .refarm config, home first.
export function refarmSearchDirs(): string[] {
	return [
		path.join(os.homedir(), ".refarm"),
		path.join(process.cwd(), ".refarm"),
	];
}

function detectProvider(): boolean {
	if (process.env.MODEL_PROVIDER) return true;
	if (process.env.MODEL_DEFAULT_PROVIDER) return true;

	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return true;
		if (hasIdentityProvider(path.join(base, "identity.json"))) return true;

		const configFile = path.join(base, "config.json");
		if (hasConfigProvider(configFile)) return true;
	}

	return false;
}

function hasConfigProvider(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	try {
		const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
			provider?: unknown;
			default_provider?: unknown;
			modelProvider?: unknown;
			tokens?: { modelProvider?: unknown };
		};
		return (
			typeof config.provider === "string" ||
			typeof config.default_provider === "string" ||
			typeof config.modelProvider === "string" ||
			typeof config.tokens?.modelProvider === "string"
		);
	} catch {
		return false;
	}
}

function hasIdentityProvider(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	try {
		const identity = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
			modelProvider?: unknown;
			tokens?: { modelProvider?: unknown };
		};
		return (
			typeof identity.modelProvider === "string" ||
			typeof identity.tokens?.modelProvider === "string"
		);
	} catch {
		return false;
	}
}

/** Read runtime autostart preference from env or the nearest .refarm/config.json. */
export function readAutostartMode(): AutostartMode {
	const runtimeEnvMode = parseAutostartMode(process.env.REFARM_RUNTIME_AUTOSTART);
	if (runtimeEnvMode) return runtimeEnvMode;

	const farmhandEnvMode = parseAutostartMode(process.env.REFARM_FARMHAND_AUTOSTART);
	if (farmhandEnvMode) return farmhandEnvMode;

	let resolvedConfigMode: AutostartMode | null = null;
	for (const base of refarmSearchDirs()) {
		const configFile = path.join(base, "config.json");
		if (!fs.existsSync(configFile)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
				autostart?: string;
			};
			const configMode = parseAutostartMode(config.autostart);
			if (configMode) resolvedConfigMode = configMode;
		} catch {
			// ignore malformed config
		}
	}
	return resolvedConfigMode ?? "ask";
}

function parseAutostartMode(value: string | undefined): AutostartMode | null {
	return parseRuntimeAutostartMode(value);
}

export function readTractorEngineMode(): TractorEngineMode {
	const envMode = parseTractorEngineMode(process.env.REFARM_TRACTOR_ENGINE);
	if (envMode) return envMode;

	let resolved: TractorEngineMode | null = null;
	for (const base of refarmSearchDirs()) {
		const configFile = path.join(base, "config.json");
		if (!fs.existsSync(configFile)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
				tractor?: { engine?: string };
			};
			const configMode = parseTractorEngineMode(config.tractor?.engine);
			if (configMode) resolved = configMode;
		} catch {
			// ignore malformed config
		}
	}
	return resolved ?? "auto";
}

function parseTractorEngineMode(value: string | undefined): TractorEngineMode | null {
	return parseRuntimeEngineMode(value);
}

function tractorBinaryPath(repoRoot: string): string {
	const targetDir = process.env.CARGO_TARGET_DIR
		? path.resolve(process.env.CARGO_TARGET_DIR)
		: path.join(repoRoot, "packages", "tractor", "target");
	return path.join(targetDir, "release", process.platform === "win32" ? "tractor.exe" : "tractor");
}

function tractorBuildCommand(repoRoot: string): string {
	return createPackageScriptCommand({
		cwd: path.join(repoRoot, "packages", "tractor"),
		repoRoot,
		script: "build",
	}).display;
}

export function resolveLaunchRuntime(
	repoRoot: string,
	configuredEngine: TractorEngineMode = readTractorEngineMode(),
): LaunchRuntimeSelection {
	if (configuredEngine === "ts") {
		return {
			configuredEngine,
			activeEngine: "ts",
			reason: "configured-ts",
		};
	}
	if (configuredEngine === "rust") {
		if (!fs.existsSync(tractorBinaryPath(repoRoot))) {
			throw new Error(
				`tractor.engine=rust but the Rust tractor binary is not built at ${tractorBinaryPath(repoRoot)}. Build it with: ${tractorBuildCommand(repoRoot)}`,
			);
		}
		return {
			configuredEngine,
			activeEngine: "rust",
			reason: "configured-rust",
		};
	}
	if (fs.existsSync(tractorBinaryPath(repoRoot))) {
		return {
			configuredEngine,
			activeEngine: "rust",
			reason: "auto-rust-available",
		};
	}
	return {
		configuredEngine,
		activeEngine: "ts",
		reason: "auto-ts-fallback",
	};
}

/** Compute the monorepo root from this file's location. */
export function findRepoRoot(): string {
	const __filename = fileURLToPath(import.meta.url);
	// apps/refarm/src/commands/ → up 4 levels → repo root
	return path.resolve(path.dirname(__filename), "../../../../");
}

export function defaultLaunchDeps(): LaunchDeps {
	const deps: LaunchDeps = {
		autostartMode: readAutostartMode(),
		operator: createStdioOperatorChannel(),

		spawnRuntime(repoRoot) {
			const runtime = resolveLaunchRuntime(repoRoot);
			const command = resolveRuntimeLaunchCommand(repoRoot, runtime.activeEngine);
			startRuntimeProcess(command);
		},
		resolveRuntime: resolveLaunchRuntime,

		async probeRuntimeUntilReady() {
			return waitForRuntimeReady();
		},

		async recoverProvider() {
			process.stderr.write(chalk.red("✗  No model provider configured.\n\n"));
			const go = await deps.operator.ask({ type: "confirm", question: "   Configure now?", default: true });
			if (!go) {
				console.error(chalk.dim("   Run `refarm sow` when ready."));
				console.error(chalk.dim("   Inspect route: `refarm model current`."));
				console.error(chalk.dim("   List providers: `refarm model providers`."));
				return false;
			}
			// Re-invoke the same CLI binary with the `sow` subcommand.
			// process.argv[0] = node binary, process.argv[1] = refarm entry script.
			spawnSync(process.argv[0]!, [process.argv[1]!, "sow"], { stdio: "inherit" });
			return detectProvider();
		},
	};
	return deps;
}

/**
 * Offer to auto-start the configured Refarm runtime when the provider is
 * configured but the sidecar is not running.
 */
export async function autoStartFarmhand(
	repoRoot: string,
	deps: LaunchDeps,
): Promise<boolean> {
	return autoStartRuntime(repoRoot, deps);
}

export async function autoStartRuntime(
	repoRoot: string,
	deps: LaunchDeps,
): Promise<boolean> {
	const mode = deps.autostartMode ?? "ask";

	if (mode === "never") {
		process.stderr.write(chalk.red("✗  Refarm runtime is not running.\n"));
		console.error(chalk.dim("   Start now:        refarm runtime start"));
		for (const line of runtimeStartHelpLines(repoRoot)) {
			console.error(chalk.dim(`   ${line}`));
		}
		console.error(chalk.dim("   Diagnose:         refarm doctor"));
		return false;
	}

	process.stderr.write(chalk.red("✗  Refarm runtime is not running.\n\n"));

	if (mode === "ask") {
		const confirmed = await deps.operator.ask({ type: "confirm", question: "   Start it now?", default: true });
		if (!confirmed) {
			console.error(chalk.dim("\n   Start later:  refarm runtime start"));
			console.error(chalk.dim("   Diagnose:     refarm doctor"));
			return false;
		}
	}

	try {
		const runtime = deps.resolveRuntime?.(repoRoot);
		const runtimeLabel = runtime
			? runtime.activeEngine === "rust"
				? "Rust Tractor"
				: "TypeScript Farmhand"
			: "selected runtime";
		const startCommand = runtime
			? resolveRuntimeLaunchCommand(repoRoot, runtime.activeEngine).display
			: null;
		process.stdout.write(chalk.dim(`   → Starting ${runtimeLabel}...`));
		if (startCommand) {
			process.stdout.write(chalk.dim(`\n   command: ${startCommand}\n`));
		}
		const spawn = deps.spawnRuntime ?? deps.spawnFarmhand;
		if (!spawn) throw new Error("No runtime starter is configured.");
		spawn(repoRoot);
	} catch (error) {
		process.stdout.write("  " + chalk.red("✗ Failed") + "\n");
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.dim(`   ${message}`));
		console.error(chalk.dim("   Diagnose:  refarm doctor"));
		return false;
	}

	const start = Date.now();
	const probe = deps.probeRuntimeUntilReady ?? deps.probeFarmhandUntilReady;
	const ready = probe ? await probe() : false;
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (ready) {
		process.stdout.write("  " + chalk.green("✓ Ready") + chalk.dim(` (${elapsed}s)`) + "\n\n");
		return true;
	}

	process.stdout.write("  " + chalk.red("✗ Timed out") + "\n");
	console.error(chalk.dim("   Run `refarm doctor` for diagnostics."));
	for (const line of runtimeStartHelpLines(repoRoot)) {
		console.error(chalk.dim(`   ${line.replace("start:", "fallback:")}`));
	}
	return false;
}

export function printSessionGuide(r: SessionReadiness): void {
	if (isFirstRun()) {
		printOnboarding();
		return;
	}

	if (!r.providerConfigured && !isRuntimeRunning(r)) {
		console.error(chalk.red("✗  refarm is not configured yet.\n"));
		console.error(
			chalk.dim("   Configure your model provider:  ") + chalk.cyan("refarm sow"),
		);
		console.error(
			chalk.dim("   Inspect current model route:     ") + chalk.cyan("refarm model current"),
		);
		console.error(
			chalk.dim("   List provider defaults:         ") + chalk.cyan("refarm model providers"),
		);
		return;
	}

	if (!r.providerConfigured) {
		console.error(chalk.red("✗  No model provider configured.\n"));
		console.error(
			chalk.dim("   Set up a provider:  ") + chalk.cyan("refarm sow"),
		);
		console.error(
			chalk.dim("   Inspect route:      ") + chalk.cyan("refarm model current"),
		);
		console.error(
			chalk.dim("   List providers:     ") + chalk.cyan("refarm model providers"),
		);
		console.error(
			chalk.dim("   Use Ollama:         ") +
				chalk.cyan("ollama serve") +
				chalk.dim("  (then refarm sow)"),
		);
		return;
	}

	if (!isRuntimeRunning(r)) {
		console.error(chalk.red("✗  Refarm runtime is not running.\n"));
		console.error(
			chalk.dim("   Diagnose:  ") + chalk.cyan("refarm doctor"),
		);
	}
}

export function printOnboarding(): void {
	console.log(chalk.bold("Welcome to refarm.") + "\n");
	console.log(chalk.bold("To get started:\n"));
	console.log(
		"  " + chalk.cyan("1.") + "  Configure credentials:  " + chalk.cyan("refarm sow"),
	);
	console.log(
		"  " + chalk.cyan("2.") + "  Then run:               " + chalk.cyan("refarm"),
	);
	console.log(chalk.dim("\n  The Refarm runtime starts automatically on first use."));
	console.log();
	console.log(chalk.dim("Need help?  ") + chalk.cyan("refarm doctor"));
}
