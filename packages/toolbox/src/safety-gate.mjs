#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const DEFAULT_PROFILES = {
	micro: [
		{
			id: "env-safety",
			command: ["bash", "scripts/env-safety-check.sh", "--warn"],
			timeoutMs: 30_000,
		},
	],
};

function normalizeCommand(command) {
	if (Array.isArray(command)) return command;
	if (typeof command === "string") return command.trim().split(/\s+/).filter(Boolean);
	return null;
}

function normalizeStep(step) {
	if (!step || typeof step !== "object") return null;
	if (!step.id || !step.command) return null;

	const command = normalizeCommand(step.command);
	if (!command || command.length === 0) return null;

	return {
		id: String(step.id),
		command,
		timeoutMs: Number.isInteger(step.timeoutMs) ? step.timeoutMs : undefined,
		required: step.required,
		label: step.label || null,
	};
}

function normalizeProfiles(rawProfiles = {}) {
	const normalized = {};
	if (!rawProfiles || typeof rawProfiles !== "object" || Array.isArray(rawProfiles)) return normalized;

	for (const [name, profile] of Object.entries(rawProfiles)) {
		if (!Array.isArray(profile)) continue;
		const normalizedSteps = [];
		for (const step of profile) {
			const normalizedStep = normalizeStep(step);
			if (normalizedStep) normalizedSteps.push(normalizedStep);
		}
		normalized[name] = normalizedSteps;
	}

	return normalized;
}

function parseArgs(argv) {
	let mode = "micro";
	let strict = false;
	let json = false;
	let requiredProfile = true;
	let maxDurationMs = null;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--strict":
				strict = true;
				break;
			case "--json":
				json = true;
				break;
			case "--allow-optional":
				requiredProfile = false;
				break;
			case "--max-duration-ms":
				{
					const value = Number.parseInt(argv[index + 1], 10);
					if (Number.isInteger(value) && value > 0) {
						maxDurationMs = value;
					}
				}
				break;
			default:
				if (typeof arg === "string" && arg.startsWith("--max-duration-ms=")) {
					const value = Number.parseInt(arg.split("=")[1], 10);
					if (Number.isInteger(value) && value > 0) {
						maxDurationMs = value;
					}
				} else if (typeof arg === "string" && arg && !arg.startsWith("--")) {
					mode = arg;
				}
				break;
		}
	}

	return {
		mode,
		strict,
		json,
		requiredProfile,
		maxDurationMs,
	};
}

function formatMs(totalMs) {
	const sec = (totalMs / 1000).toFixed(1);
	return `${sec}s`;
}

function commandTimeoutForStep(stepTimeoutMs, maxDurationMs, gateElapsedMs) {
	const baseTimeout = Number.isInteger(stepTimeoutMs) ? stepTimeoutMs : 120_000;
	if (!Number.isInteger(maxDurationMs) || maxDurationMs <= 0) return baseTimeout;

	const remainingMs = maxDurationMs - gateElapsedMs;
	if (remainingMs <= 0) return 0;
	return Math.min(baseTimeout, remainingMs);
}

function runCommand(step, commandTimeoutMs) {
	const started = Date.now();
	const run = spawnSync(step.command[0], step.command.slice(1), {
		stdio: "inherit",
		timeout: commandTimeoutMs,
		env: { ...process.env },
	});
	const elapsedMs = Date.now() - started;
	return {
		id: step.id,
		command: step.command,
		ok: run.status === 0,
		exitCode: run.status,
		signal: run.signal ?? null,
		elapsedMs,
	};
}

export function selectProfile(name, fallbackProfiles = {}) {
	const normalizedFallback = normalizeProfiles(fallbackProfiles);
	return {
		...DEFAULT_PROFILES,
		...normalizedFallback,
	}[name];
}

export function resolveSteps(name, fallbackProfiles = {}) {
	return selectProfile(name, fallbackProfiles);
}

function printSummary(results, jsonOutput) {
	if (jsonOutput) {
		console.log(JSON.stringify({ results }, null, 2));
		return;
	}

	const total = results.reduce((acc, item) => acc + item.elapsedMs, 0);
	const failed = results.filter((item) => !item.ok);
	console.log("\nSafety gate");
	console.log(`Total: ${formatMs(total)}`);
	for (const result of results) {
		const status = result.ok ? "PASS" : "WARN";
		console.log(`- ${status}: ${result.id} (${formatMs(result.elapsedMs)})`);
	}
	if (failed.length > 0) {
		console.log(`Failed: ${failed.length}`);
	}
}

export async function runSafetyGate(mode, options = {}) {
	if (Array.isArray(options)) {
		options = parseArgs(options);
	}

	const {
		strict = false,
		json = false,
		requiredProfile = true,
		profiles = {},
		maxDurationMs = null,
	} = options;
	const selectedProfile = resolveSteps(mode, profiles);

	if (!selectedProfile) {
		console.error(`Unknown safety profile: ${mode}`);
		console.error(`Usage: safety-gate <profile-name> [--strict] [--json] [--max-duration-ms <ms>]`);
		process.exitCode = 1;
		return false;
	}

	if (selectedProfile.length === 0) {
		console.error(`Safety profile '${mode}' has no executable steps.`);
		process.exitCode = 1;
		return false;
	}

	const results = [];
	let shouldFail = false;
	const gateStartedAt = Date.now();

	for (const step of selectedProfile) {
		const gateElapsedMs = Date.now() - gateStartedAt;
		if (Number.isInteger(maxDurationMs) && maxDurationMs > 0 && gateElapsedMs >= maxDurationMs) {
			results.push({
				id: "safety-budget",
				command: ["safety-gate"],
				ok: false,
				exitCode: 1,
				signal: null,
				elapsedMs: 0,
				error: `safety budget exceeded (${maxDurationMs}ms)`,
			});
			shouldFail = true;
			break;
		}

		const commandTimeoutMs = commandTimeoutForStep(step.timeoutMs, maxDurationMs, gateElapsedMs);
		const required = requiredProfile && step.required !== false;
		if (commandTimeoutMs <= 0) {
			results.push({
				id: step.id,
				command: step.command,
				ok: false,
				exitCode: 124,
				signal: null,
				elapsedMs: 0,
				error: "safety budget exceeded before running step",
			});
			shouldFail = true;
			break;
		}

		try {
			console.log(`\n[safety] ${step.id}`);
			const result = runCommand(step, commandTimeoutMs);
			results.push(result);
			if (!result.ok && (strict || required)) {
				shouldFail = true;
				break;
			}
		} catch (error) {
			results.push({
				id: step.id,
				command: step.command,
				ok: false,
				exitCode: 1,
				signal: null,
				elapsedMs: 0,
				error: String(error?.message || error),
			});
			if (required) {
				shouldFail = true;
				break;
			}
		}
	}

	printSummary(results, json);
	process.exitCode = shouldFail ? 1 : 0;
	return !shouldFail;
}

export default runSafetyGate;

const { mode, strict, json, requiredProfile, maxDurationMs } = parseArgs(process.argv.slice(2));
if (import.meta.url === `file://${process.argv[1]}`) {
	await runSafetyGate(mode, {
		strict,
		json,
		requiredProfile,
		maxDurationMs,
	});
}
