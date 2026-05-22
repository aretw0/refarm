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
import { createPackageScriptCommand } from "./package-manager.js";
import {
	resolveRuntimeLaunchCommand,
	runtimeStartHelpLines,
	startRuntimeProcess,
} from "./runtime-launcher.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_START_COMMAND,
} from "./runtime-recovery.js";
import {
	probeRuntimeReady,
	waitForRuntimeReady,
} from "./runtime-readiness.js";
import { DEFAULT_MODEL_PROVIDER } from "../model-routing.js";
import {
	hasUsableModelCredential,
	hasUsableModelCredentialSource,
} from "@refarm.dev/config";
import {
	resolveAutostartMode,
	resolveTractorEngineMode,
	type AutostartMode,
	type TractorEngineMode,
} from "../utils/runtime-config.js";

export type { AutostartMode, TractorEngineMode } from "../utils/runtime-config.js";

export interface SessionReadiness {
	providerConfigured: boolean;
	runtimeRunning?: boolean;
	farmhandRunning?: boolean;
}

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
	const envProvider = stringValue(process.env.MODEL_PROVIDER) ?? stringValue(process.env.MODEL_DEFAULT_PROVIDER);
	if (envProvider) return hasProviderCredential(envProvider, {});
	if (hasProviderCredential(DEFAULT_MODEL_PROVIDER, {})) return true;

	for (const base of refarmSearchDirs()) {
		const envFile = path.join(base, ".env");
		if (hasEnvProvider(envFile)) return true;
		if (hasIdentityProvider(path.join(base, "identity.json"))) return true;

		const configFile = path.join(base, "config.json");
		if (hasConfigProvider(configFile)) return true;
	}

	return false;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasProviderCredential(
	provider: string | undefined,
	tokens: {
		modelProvider?: unknown;
		modelApiKey?: unknown;
		oauthProvider?: unknown;
		oauthCredentials?: unknown;
	},
	env: Record<string, string | undefined> = process.env,
): boolean {
	const normalizedProvider = stringValue(provider);
	if (!normalizedProvider) return false;
	return hasUsableModelCredential(normalizedProvider, tokens, env);
}

function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};
	const env: Record<string, string> = {};
	for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const equal = trimmed.indexOf("=");
		if (equal <= 0) continue;
		const key = trimmed.slice(0, equal).trim();
		let value = trimmed.slice(equal + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

function hasEnvProvider(filePath: string): boolean {
	const env = parseEnvFile(filePath);
	const provider = stringValue(env.MODEL_PROVIDER) ?? stringValue(env.MODEL_DEFAULT_PROVIDER);
	if (provider) return hasProviderCredential(provider, {}, { ...process.env, ...env });
	return Object.keys(env).some((key) => key.endsWith("_API_KEY") && stringValue(env[key]));
}

function hasConfigProvider(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	try {
		const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
			string,
			unknown
		>;
		return hasUsableModelCredentialSource(config, process.env);
	} catch {
		return false;
	}
}

function hasIdentityProvider(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	try {
		const identity = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
			string,
			unknown
		>;
		return hasUsableModelCredentialSource(identity, process.env);
	} catch {
		return false;
	}
}

/** Read runtime autostart preference from env or the nearest .refarm/config.json. */
export function readAutostartMode(): AutostartMode {
	return resolveAutostartMode().value;
}

export function readTractorEngineMode(): TractorEngineMode {
	return resolveTractorEngineMode().value;
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
			process.stderr.write(chalk.red("✗  No usable model credentials configured.\n\n"));
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
		console.error(chalk.dim(`   Start now:        ${RUNTIME_START_COMMAND}`));
		for (const line of runtimeStartHelpLines(repoRoot)) {
			console.error(chalk.dim(`   ${line}`));
		}
		console.error(chalk.dim(`   Diagnose:         ${RUNTIME_DOCTOR_COMMAND}`));
		return false;
	}

	process.stderr.write(chalk.red("✗  Refarm runtime is not running.\n\n"));

	if (mode === "ask") {
		const confirmed = await deps.operator.ask({ type: "confirm", question: "   Start it now?", default: true });
		if (!confirmed) {
			console.error(chalk.dim(`\n   Start later:  ${RUNTIME_START_COMMAND}`));
			console.error(chalk.dim(`   Diagnose:     ${RUNTIME_DOCTOR_COMMAND}`));
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
		if (runtime?.reason === "auto-ts-fallback") {
			process.stdout.write(
				chalk.dim(
					`\n   rust tractor: not built; using TypeScript fallback`,
				),
			);
			process.stdout.write(
				chalk.dim(`\n   build rust: ${tractorBuildCommand(repoRoot)}`),
			);
		}
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
		console.error(chalk.dim(`   Diagnose:  ${RUNTIME_DOCTOR_COMMAND}`));
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
	console.error(chalk.dim(`   Run \`${RUNTIME_DOCTOR_COMMAND}\` for diagnostics.`));
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
			chalk.dim("   Configure model credentials:    ") + chalk.cyan("refarm sow"),
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
		console.error(chalk.red("✗  No usable model credentials configured.\n"));
		console.error(
			chalk.dim("   Set up credentials: ") + chalk.cyan("refarm sow"),
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
			chalk.dim("   Diagnose:  ") + chalk.cyan(RUNTIME_DOCTOR_COMMAND),
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
	console.log(chalk.dim("Need help?  ") + chalk.cyan(RUNTIME_DOCTOR_COMMAND));
}
