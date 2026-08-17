/**
 * Session launch policy — readiness check, auto-start, and guide output.
 * No readline REPL, no Commander. Just policy.
 */

import { ambientActivitySink, newActivityRef } from "@refarm.dev/capabilities";
import { executeProcessHandoff } from "@refarm.dev/cli/process-handoff";
import {
	hasUsableModelCredential,
	hasUsableModelCredentialSource,
	modelCredentialSource,
} from "@refarm.dev/config";
import { createStdioOperatorChannel, type OperatorChannel } from "@refarm.dev/prompt-contract-v1";
import {
	autoStartRuntime as operatorAutoStartRuntime,
	type AutostartActivityReporter,
	type AutostartVocabulary,
} from "@refarm.dev/runtime-operator";
import { resolveSiloHome } from "@refarm.dev/silo";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refarmCommand } from "../brand.js";
import {
	DEFAULT_MODEL_PROVIDER,
	MODEL_DEFAULT_PROVIDER_ENV_VAR,
	MODEL_PROVIDER_ENV_VAR,
} from "../model-routing.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import {
	resolveAutostartMode,
	resolveAutostartModeAsync,
	resolveTractorEngineMode,
	resolveTractorEngineModeAsync,
	type AutostartMode,
	type TractorEngineMode,
} from "../utils/runtime-config.js";
import { resolveSovereignConfig } from "../utils/sovereign-config.js";
import {
	MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND,
	MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND,
	MODEL_CREDENTIALS_MISSING_MESSAGE,
	MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND,
	MODEL_CREDENTIALS_SETUP_COMMAND,
	missingModelCredentialDeferredLines,
} from "./model-credential-guidance.js";
import { createPackageScriptCommand } from "./package-manager.js";
import { resolveRuntimeLaunchCommand, startRuntimeProcess } from "./runtime-launcher.js";
import {
	probeRuntimeReady,
	waitForRuntimeOutcome,
	waitForRuntimeReady,
	type RuntimeWaitOutcome,
} from "./runtime-readiness.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
} from "./runtime-recovery.js";

export type { AutostartMode, TractorEngineMode } from "../utils/runtime-config.js";

/** How long to wait for the runtime on a COLD boot before giving up. The generic readiness
 * default (10s) is tuned for quick "is it up?" status checks; a first Rust-tractor boot —
 * WASI plugin load + graph warm-up + reapers — measured ~13s here, so autostart waits
 * longer (with margin for a loaded container / fresh build) to avoid a false timeout on the
 * one path where the daemon is legitimately still coming up. */
const RUNTIME_COLD_BOOT_TIMEOUT_MS = 30_000;

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
	/** Honest wait: returns why the wait ended so a slow boot isn't reported as failure. */
	probeRuntimeUntilOutcome?(): Promise<RuntimeWaitOutcome>;
	/** Surface-neutral "working" signal around the boot wait (spinner/pill). */
	activity?: AutostartActivityReporter;
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
	return {
		providerConfigured,
		runtimeRunning,
		farmhandRunning: runtimeRunning,
	};
}

// Exported for tests — returns dirs to search for .refarm config, home first.
//
// Silo's home is included because that is where `refarm sow` actually stores an
// OAuth model credential (`identity.json` under `SILO_HOME || REFARM_HOME ||
// ~/.silo`). Without it, a machine with REFARM_HOME unset puts the store in
// ~/.silo where this search never looked, so `model current` reported
// `silo-oauth` while `ask` refused with "no usable credentials" — and re-running
// `sow` could not help, because `sow` writes exactly where the gate was not
// looking. When the two homes resolve to the same directory the Set dedupes,
// which is why the defect was invisible on any setup that exports REFARM_HOME.
export function refarmSearchDirs(): string[] {
	return Array.from(
		new Set([resolveRefarmHome(), resolveSiloHome(), path.join(process.cwd(), ".refarm")]),
	);
}

/**
 * What a credential source contributes to readiness:
 *   "usable"           — a chosen provider WITH a working credential → ready.
 *   "declared-missing" — a provider was chosen but its credential is absent →
 *                        NOT ready; the miss must surface (ask/model point at
 *                        recovery). The keyless floor must NOT paper this over.
 *   "none"             — this source chose no provider at all.
 */
type ProviderEvidence = "usable" | "declared-missing" | "none";

function detectProvider(): boolean {
	// Readiness is a 3-state precedence, honoring one rule: a provider CHOSEN
	// anywhere (env, .env, Silo identity, or config) is authoritative — its own
	// credential decides, and a missing one must SURFACE rather than be silently
	// rescued. Aggregate every source's evidence:
	//   • any "usable"           → ready now.
	//   • else any "declared-missing" → a choice failed → NOT ready (warn).
	//   • else all "none"        → nothing was chosen → the keyless ollama floor
	//                              makes the truly zero-config case ready.
	// (Liveness — whether the resolved provider actually responds — is a separate
	// runtime concern, deliberately not folded into this static readiness check.)
	let sawDeclaredMissing = false;

	for (const evidence of collectProviderEvidence()) {
		if (evidence === "usable") return true;
		if (evidence === "declared-missing") sawDeclaredMissing = true;
	}

	if (sawDeclaredMissing) return false;
	return hasProviderCredential(DEFAULT_MODEL_PROVIDER, {});
}

/** Every credential source's evidence, in precedence order (env first). */
function* collectProviderEvidence(): Generator<ProviderEvidence> {
	const envProvider =
		stringValue(process.env[MODEL_PROVIDER_ENV_VAR]) ??
		stringValue(process.env[MODEL_DEFAULT_PROVIDER_ENV_VAR]);
	if (envProvider) {
		yield hasProviderCredential(envProvider, {}) ? "usable" : "declared-missing";
	}

	for (const base of refarmSearchDirs()) {
		yield envFileEvidence(path.join(base, ".env"));
		yield identityEvidence(path.join(base, "identity.json"));
		yield configEvidence(path.join(base, "config.json"));
		yield catalogEvidence(path.join(base, "model-accounts.json"));
	}
}

/**
 * A HEALTHY ACCOUNT IN THE CATALOG IS A USABLE CREDENTIAL, and this gate did not know it.
 *
 * Measured on the operator's node 2026-08-17, right after `refarm sow` succeeded: three healthy
 * accounts, `refarm credential list` naming all three, and every dispatch refused with "No usable
 * model credentials configured."
 *
 * `sow` writes the secret into Silo's `model` namespace and RETIRES the flat entry — that is what
 * the namespaced store is for. Every source above reads the flat shape, so a provider still
 * declared in `identity.json` resolved to `declared-missing` against an emptied map. The more
 * completely a node migrated, the more certain this gate became that it had nothing (ISS-138).
 *
 * ONLY `healthy` COUNTS. An `incomplete` descriptor is a login that happened and a secret that did
 * not survive; treating it as evidence would turn a fail-closed gate into one that passes on
 * intent. The descriptor carries no secret material, so this stays a plain synchronous read.
 */
function catalogEvidence(filePath: string): ProviderEvidence {
	if (!fs.existsSync(filePath)) return "none";
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		if (!Array.isArray(parsed)) return "none";
		const usable = parsed.some(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as { health?: unknown }).health === "healthy",
		);
		// "none", never "declared-missing", when the catalog holds nothing usable: a catalog is not
		// a declaration of intent, so an empty one has chosen nothing and must not veto another
		// source that has a working credential.
		return usable ? "usable" : "none";
	} catch {
		return "none";
	}
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

function envFileEvidence(filePath: string): ProviderEvidence {
	// A .env counts only when it DECLARES a provider: a missing file, or one with
	// a stray key but no chosen provider, chose nothing ("none"). A declared
	// provider then resolves to "usable" or "declared-missing" by its credential.
	if (!fs.existsSync(filePath)) return "none";
	const env = parseEnvFile(filePath);
	const provider =
		stringValue(env[MODEL_PROVIDER_ENV_VAR]) ?? stringValue(env[MODEL_DEFAULT_PROVIDER_ENV_VAR]);
	if (!provider) return "none";
	const mergedEnv = { ...process.env, ...env };
	return hasProviderCredential(provider, {}, mergedEnv) ? "usable" : "declared-missing";
}

function configEvidence(filePath: string): ProviderEvidence {
	return sourceFileEvidence(filePath);
}

function identityEvidence(filePath: string): ProviderEvidence {
	return sourceFileEvidence(filePath);
}

/** Shared evidence for a JSON credential source (config.json / identity.json). */
function sourceFileEvidence(filePath: string): ProviderEvidence {
	if (!fs.existsSync(filePath)) return "none";
	try {
		const source = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
		// No provider chosen in this file → it contributes nothing.
		if (!modelCredentialSource(source).provider) return "none";
		return hasUsableModelCredentialSource(source, process.env) ? "usable" : "declared-missing";
	} catch {
		return "none";
	}
}

/** Read runtime autostart preference from env or the nearest .refarm/config.json. */
export function readAutostartMode(): AutostartMode {
	return resolveAutostartMode().value;
}

export function readTractorEngineMode(): TractorEngineMode {
	return resolveTractorEngineMode().value;
}

/**
 * Node-aware readers: env → cwd config (fs-first / graph node) → home fs →
 * default. Use these where a replicated (fs-less) device should still honor its
 * config node; the sync readers above stay for the config command's which-file
 * reporting. Not memoized — these fire at boot/status, not per request; add a
 * dedicated per-scalar cache only if a hot async caller ever emerges.
 */
export async function readAutostartModeAsync(): Promise<AutostartMode> {
	return (await resolveAutostartModeAsync(() => resolveSovereignConfig())).value;
}

export async function readTractorEngineModeAsync(): Promise<TractorEngineMode> {
	return (await resolveTractorEngineModeAsync(() => resolveSovereignConfig())).value;
}

function tractorBinaryPath(repoRoot: string): string {
	// Mirrors `.cargo/config.toml` (`target-dir = ".cache/cargo-target"`): cargo resolves
	// that relative dir against the repo root, so every default build lands there.
	const targetDir = process.env.CARGO_TARGET_DIR
		? path.resolve(process.env.CARGO_TARGET_DIR)
		: path.join(repoRoot, ".cache", "cargo-target");
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
		// autostartMode is intentionally left unset — autoStartRuntime resolves it
		// node-aware at its async decision point (defaultLaunchDeps stays sync, so
		// its callers ask.ts/chat.ts/session.ts do not need to await it).
		operator: createStdioOperatorChannel(),

		spawnRuntime(repoRoot) {
			const runtime = resolveLaunchRuntime(repoRoot);
			const command = resolveRuntimeLaunchCommand(repoRoot, runtime.activeEngine);
			startRuntimeProcess(command);
		},
		resolveRuntime: resolveLaunchRuntime,

		async probeRuntimeUntilReady() {
			return waitForRuntimeReady({ timeoutMs: RUNTIME_COLD_BOOT_TIMEOUT_MS });
		},

		// The honest form: a cold boot that outruns the readiness deadline reports
		// "still starting" (daemon alive) rather than a scary "timed out" that lies.
		async probeRuntimeUntilOutcome() {
			return waitForRuntimeOutcome({ timeoutMs: RUNTIME_COLD_BOOT_TIMEOUT_MS });
		},

		// Emit the surface-neutral "working" signal around the boot wait, so the CLI spinner
		// (already subscribed to the ambient sink in cli-main) — and the TUI/web via the same
		// sink — SHOW that the runtime is coming up, instead of a silent multi-second gap.
		activity(label: string) {
			const activityRef = newActivityRef();
			ambientActivitySink.emit({ activityRef, phase: "started", label, kind: "runtime" });
			return (ok: boolean) => {
				ambientActivitySink.emit({ activityRef, phase: "finished", label, kind: "runtime", ok });
			};
		},

		async recoverProvider() {
			process.stderr.write(chalk.red(`✗  ${MODEL_CREDENTIALS_MISSING_MESSAGE}\n\n`));
			const go = await deps.operator.ask({
				type: "confirm",
				question: "   Configure now?",
				default: true,
			});
			if (!go) {
				for (const line of missingModelCredentialDeferredLines()) {
					console.error(chalk.dim(`   ${line}`));
				}
				return false;
			}
			// Re-invoke the same CLI binary with the `sow` subcommand.
			// process.argv[0] = node binary, process.argv[1] = refarm entry script.
			await executeProcessHandoff({
				command: process.argv[0]!,
				args: [process.argv[1]!, "sow"],
				display: refarmCommand(["sow"]),
			});
			return detectProvider();
		},
	};
	return deps;
}

/**
 * Offer to auto-start the configured Refarm runtime when the provider is
 * configured but the sidecar is not running.
 */
export async function autoStartFarmhand(repoRoot: string, deps: LaunchDeps): Promise<boolean> {
	const shouldForceTypeScript = Boolean(deps.spawnFarmhand || deps.probeFarmhandUntilReady);

	const farmhandDeps: LaunchDeps = {
		...deps,
		spawnRuntime: deps.spawnFarmhand ?? deps.spawnRuntime,
		probeRuntimeUntilReady: deps.probeFarmhandUntilReady ?? deps.probeRuntimeUntilReady,
		resolveRuntime: shouldForceTypeScript
			? (repoRootArg) => {
					const runtime = deps.resolveRuntime?.(repoRootArg);
					if (runtime?.activeEngine === "ts") {
						return {
							...runtime,
							reason: "configured-ts",
						};
					}
					return {
						configuredEngine: runtime?.configuredEngine ?? "auto",
						activeEngine: "ts",
						reason:
							runtime?.activeEngine === "rust" ||
							runtime?.reason === "configured-rust" ||
							runtime?.reason === "auto-rust-available"
								? "auto-ts-fallback"
								: "configured-ts",
					};
				}
			: deps.resolveRuntime,
	};

	return autoStartRuntime(repoRoot, farmhandDeps);
}

/** The refarm app's autostart vocabulary — the shared machine (in
 * @refarm.dev/runtime-operator) prints THESE command strings and labels, so the
 * guidance names refarm's commands. A white-label app (dgk) passes its own. */
const REFARM_AUTOSTART_VOCABULARY: AutostartVocabulary = {
	ensureCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	startCommand: RUNTIME_START_COMMAND,
	doctorNextActionCommand: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	doctorCommand: RUNTIME_DOCTOR_COMMAND,
	engineLabel: (engine) => (engine === "rust" ? "Rust Tractor" : "TypeScript Farmhand"),
	buildRustCommand: (repoRoot) => tractorBuildCommand(repoRoot),
};

export async function autoStartRuntime(repoRoot: string, deps: LaunchDeps): Promise<boolean> {
	// Resolve the autostart mode node-aware here (an async point) when the caller
	// did not inject one — instead of eagerly + synchronously in defaultLaunchDeps,
	// which could not see the config graph node.
	const mode = deps.autostartMode ?? (await readAutostartModeAsync());
	const spawn = deps.spawnRuntime ?? deps.spawnFarmhand;
	const probe = deps.probeRuntimeUntilReady ?? deps.probeFarmhandUntilReady;

	// Delegate to the shared, white-label autostart machine, injecting refarm's
	// vocabulary and its spawn/probe/resolve. The narration + state machine live once
	// in the operator; only the command strings differ per app.
	return operatorAutoStartRuntime(repoRoot, REFARM_AUTOSTART_VOCABULARY, {
		operator: deps.operator,
		mode,
		spawnRuntime: (root) => {
			if (!spawn) throw new Error("No runtime starter is configured.");
			spawn(root);
		},
		probeRuntimeUntilReady: async () => (probe ? await probe() : false),
		// Forward the honest-outcome probe and the "working" signal so the operator machine
		// narrates a slow boot as "still starting" (not a false timeout) and surfaces show a
		// spinner while the daemon comes up. Both are injected in defaultLaunchDeps.
		probeRuntimeUntilOutcome: deps.probeRuntimeUntilOutcome,
		activity: deps.activity,
		resolveRuntime: deps.resolveRuntime
			? (root) => {
					const runtime = deps.resolveRuntime!(root);
					return { activeEngine: runtime.activeEngine, reason: runtime.reason };
				}
			: undefined,
	});
}

export function printSessionGuide(r: SessionReadiness): void {
	if (isFirstRun()) {
		printOnboarding();
		return;
	}

	if (!r.providerConfigured && !isRuntimeRunning(r)) {
		console.error(chalk.red("✗  refarm is not configured yet.\n"));
		console.error(
			chalk.dim("   Configure model credentials:    ") +
				chalk.cyan(MODEL_CREDENTIALS_SETUP_COMMAND),
		);
		console.error(
			chalk.dim("   Inspect current model route:     ") +
				chalk.cyan(MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND),
		);
		console.error(
			chalk.dim("   List provider defaults:         ") +
				chalk.cyan(MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND),
		);
		return;
	}

	if (!r.providerConfigured) {
		console.error(chalk.red(`✗  ${MODEL_CREDENTIALS_MISSING_MESSAGE}\n`));
		console.error(
			chalk.dim("   Set up credentials: ") + chalk.cyan(MODEL_CREDENTIALS_SETUP_COMMAND),
		);
		console.error(
			chalk.dim("   Inspect route:      ") + chalk.cyan(MODEL_CREDENTIALS_INSPECT_ROUTE_COMMAND),
		);
		console.error(
			chalk.dim("   List providers:     ") + chalk.cyan(MODEL_CREDENTIALS_LIST_PROVIDERS_COMMAND),
		);
		console.error(
			chalk.dim("   Use Ollama:         ") +
				chalk.cyan(MODEL_CREDENTIALS_OLLAMA_SERVE_COMMAND) +
				chalk.dim(`  (then ${MODEL_CREDENTIALS_SETUP_COMMAND})`),
		);
		return;
	}

	if (!isRuntimeRunning(r)) {
		console.error(chalk.red("✗  Refarm runtime is not running.\n"));
		console.error(chalk.dim("   Diagnose:  ") + chalk.cyan(RUNTIME_DOCTOR_COMMAND));
	}
}

export function printOnboarding(): void {
	console.log(chalk.bold("Welcome to refarm.") + "\n");
	console.log(chalk.bold("To get started:\n"));
	console.log(
		"  " + chalk.cyan("1.") + "  Configure credentials:  " + chalk.cyan(refarmCommand(["sow"])),
	);
	console.log("  " + chalk.cyan("2.") + "  Then run:               " + chalk.cyan("refarm"));
	console.log(chalk.dim("\n  The Refarm runtime starts automatically on first use."));
	console.log();
	console.log(chalk.dim("Need help?  ") + chalk.cyan(RUNTIME_DOCTOR_COMMAND));
}
