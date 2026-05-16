/**
 * Session launch policy — readiness check, auto-start, and guide output.
 * No readline REPL, no Commander. Just policy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
	type OperatorChannel,
	createStdioOperatorChannel,
} from "@refarm.dev/prompt-contract-v1";

const SIDECAR_URL = "http://127.0.0.1:42001";
const FARMHAND_PROBE_TIMEOUT_MS = 1_500;
const AUTOSTART_POLL_INTERVAL_MS = 300;
const AUTOSTART_TIMEOUT_MS = 10_000;

export interface SessionReadiness {
	providerConfigured: boolean;
	farmhandRunning: boolean;
}

export type AutostartMode = "always" | "ask" | "never";

export interface LaunchDeps {
	operator: OperatorChannel;
	spawnFarmhand(repoRoot: string): void;
	probeFarmhandUntilReady(): Promise<boolean>;
	/** How to handle farmhand auto-start. Reads from config.json; default "ask". */
	autostartMode?: AutostartMode;
	/** Called when no provider is configured — returns true if provider is now ready. */
	recoverProvider?(): Promise<boolean>;
}

export function isSessionReady(r: SessionReadiness): boolean {
	return r.providerConfigured && r.farmhandRunning;
}

export function isFirstRun(): boolean {
	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return false;
		if (fs.existsSync(path.join(base, "config.json"))) return false;
	}
	return true;
}

export async function checkSessionReadiness(): Promise<SessionReadiness> {
	const providerConfigured = detectProvider();
	const farmhandRunning = await probeFarmhand();
	return { providerConfigured, farmhandRunning };
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

	for (const base of refarmSearchDirs()) {
		if (fs.existsSync(path.join(base, ".env"))) return true;

		const configFile = path.join(base, "config.json");
		if (fs.existsSync(configFile)) {
			try {
				const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
					provider?: string;
					default_provider?: string;
				};
				if (config.provider ?? config.default_provider) return true;
			} catch {
				// continue to next dir
			}
		}
	}

	return false;
}

/** Read autostart preference from the nearest .refarm/config.json. */
export function readAutostartMode(): AutostartMode {
	for (const base of refarmSearchDirs()) {
		const configFile = path.join(base, "config.json");
		if (!fs.existsSync(configFile)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
				autostart?: string;
			};
			if (config.autostart === "always" || config.autostart === "never") {
				return config.autostart;
			}
		} catch {
			// ignore malformed config
		}
	}
	return "ask";
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

		spawnFarmhand(repoRoot) {
			const child = spawn(
				"bash",
				[path.join(repoRoot, "scripts", "farmhand-start.sh"), "--background"],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},

		async probeFarmhandUntilReady() {
			const deadline = Date.now() + AUTOSTART_TIMEOUT_MS;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, AUTOSTART_POLL_INTERVAL_MS));
				if (await probeFarmhand()) return true;
			}
			return false;
		},

		async recoverProvider() {
			process.stderr.write(chalk.red("✗  No model provider configured.\n\n"));
			const go = await deps.operator.ask({ type: "confirm", question: "   Configure now?", default: true });
			if (!go) {
				console.error(chalk.dim("   Run `refarm sow` when ready."));
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
 * Offer to auto-start farmhand when the provider is configured but farmhand
 * is not running (ADR-065, Phase 1). Returns true if farmhand is now ready.
 */
export async function autoStartFarmhand(
	repoRoot: string,
	deps: LaunchDeps,
): Promise<boolean> {
	const mode = deps.autostartMode ?? "ask";

	if (mode === "never") {
		process.stderr.write(chalk.red("✗  Farmhand is not running.\n"));
		console.error(chalk.dim("   Diagnose:  refarm doctor"));
		return false;
	}

	process.stderr.write(chalk.red("✗  Farmhand is not running.\n\n"));

	if (mode === "ask") {
		const confirmed = await deps.operator.ask({ type: "confirm", question: "   Start it now?", default: true });
		if (!confirmed) {
			console.error(chalk.dim("\n   Run `refarm doctor` for diagnostics."));
			return false;
		}
	}

	process.stdout.write(chalk.dim("   → Starting farmhand..."));
	deps.spawnFarmhand(repoRoot);

	const start = Date.now();
	const ready = await deps.probeFarmhandUntilReady();
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (ready) {
		process.stdout.write("  " + chalk.green("✓ Ready") + chalk.dim(` (${elapsed}s)`) + "\n\n");
		return true;
	}

	process.stdout.write("  " + chalk.red("✗ Timed out") + "\n");
	console.error(chalk.dim("   Run `refarm doctor` for diagnostics."));
	return false;
}

async function probeFarmhand(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			FARMHAND_PROBE_TIMEOUT_MS,
		);
		const response = await fetch(`${SIDECAR_URL}/efforts/summary`, {
			signal: controller.signal,
		});
		clearTimeout(timer);
		return response.ok;
	} catch {
		return false;
	}
}

export function printSessionGuide(r: SessionReadiness): void {
	if (isFirstRun()) {
		printOnboarding();
		return;
	}

	if (!r.providerConfigured && !r.farmhandRunning) {
		console.error(chalk.red("✗  refarm is not configured yet.\n"));
		console.error(
			chalk.dim("   Configure your model provider:  ") + chalk.cyan("refarm sow"),
		);
		return;
	}

	if (!r.providerConfigured) {
		console.error(chalk.red("✗  No model provider configured.\n"));
		console.error(
			chalk.dim("   Set up a provider:  ") + chalk.cyan("refarm sow"),
		);
		console.error(
			chalk.dim("   Use Ollama:         ") +
				chalk.cyan("ollama serve") +
				chalk.dim("  (then refarm sow)"),
		);
		return;
	}

	if (!r.farmhandRunning) {
		console.error(chalk.red("✗  Farmhand is not running.\n"));
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
	console.log(chalk.dim("\n  Farmhand starts automatically on first use."));
	console.log();
	console.log(chalk.dim("Need help?  ") + chalk.cyan("refarm doctor"));
}
