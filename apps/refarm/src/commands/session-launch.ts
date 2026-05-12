/**
 * Session launch policy — pure readiness check and guide output.
 * No readline, no REPL, no Commander. Just policy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";

const SIDECAR_URL = "http://127.0.0.1:42001";
const FARMHAND_PROBE_TIMEOUT_MS = 1_500;

export interface SessionReadiness {
	providerConfigured: boolean;
	farmhandRunning: boolean;
}

export function isSessionReady(r: SessionReadiness): boolean {
	return r.providerConfigured && r.farmhandRunning;
}

export function isFirstRun(): boolean {
	const base = path.join(os.homedir(), ".refarm");
	const hasEnv = fs.existsSync(path.join(base, ".env"));
	const hasConfig = fs.existsSync(path.join(base, "config.json"));
	return !hasEnv && !hasConfig;
}

export async function checkSessionReadiness(): Promise<SessionReadiness> {
	const providerConfigured = detectProvider();
	const farmhandRunning = await probeFarmhand();
	return { providerConfigured, farmhandRunning };
}

function detectProvider(): boolean {
	if (process.env.LLM_PROVIDER) return true;

	const base = path.join(os.homedir(), ".refarm");
	if (fs.existsSync(path.join(base, ".env"))) return true;

	const configFile = path.join(base, "config.json");
	if (fs.existsSync(configFile)) {
		try {
			const config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as {
				provider?: string;
			};
			return Boolean(config.provider);
		} catch {
			return false;
		}
	}

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
			chalk.dim("   Configure your LLM provider:  ") + chalk.cyan("refarm keys"),
		);
		console.error(
			chalk.dim("   Then start farmhand:          ") +
				chalk.cyan("npm run farmhand:daemon"),
		);
		return;
	}

	if (!r.providerConfigured) {
		console.error(chalk.red("✗  No LLM provider configured.\n"));
		console.error(
			chalk.dim("   Set up a provider:  ") + chalk.cyan("refarm keys"),
		);
		console.error(
			chalk.dim("   Use Ollama:         ") +
				chalk.cyan("ollama serve") +
				chalk.dim("  (then refarm keys)"),
		);
		return;
	}

	if (!r.farmhandRunning) {
		console.error(chalk.red("✗  Farmhand is not running.\n"));
		console.error(
			chalk.dim("   Start it:   ") + chalk.cyan("npm run farmhand:daemon"),
		);
		console.error(
			chalk.dim("   Or inline:  ") + chalk.cyan("npm run farmhand:start"),
		);
	}
}

export function printOnboarding(): void {
	console.log(chalk.bold("Welcome to refarm.") + "\n");
	console.log(chalk.bold("To get started:\n"));
	console.log(
		"  " + chalk.cyan("1.") + "  Configure a provider:  " + chalk.cyan("refarm keys"),
	);
	console.log(
		"  " + chalk.cyan("2.") + "  Start farmhand:        " + chalk.cyan("npm run farmhand:daemon"),
	);
	console.log(
		"  " + chalk.cyan("3.") + "  Then run:              " + chalk.cyan("refarm"),
	);
	console.log();
	console.log(chalk.dim("Need help?  ") + chalk.cyan("refarm doctor"));
}
