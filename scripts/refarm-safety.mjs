#!/usr/bin/env node

import { loadConfig } from "@refarm.dev/config";
import { runSafetyGate } from "../packages/toolbox/src/safety-gate.mjs";

function isValidStep(step) {
	if (!step || typeof step !== "object") return false;
	if (typeof step.id !== "string" || !step.id.trim()) return false;
	if (typeof step.command !== "string" && !Array.isArray(step.command)) return false;
	return true;
}

function parseMaxDurationMs(argv) {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--max-duration-ms") {
			const value = Number.parseInt(argv[index + 1], 10);
			if (Number.isInteger(value) && value > 0) {
				return value;
			}
			continue;
		}
		if (arg.startsWith("--max-duration-ms=")) {
			const value = Number.parseInt(arg.split("=")[1], 10);
			if (Number.isInteger(value) && value > 0) {
				return value;
			}
		}
	}

	return null;
}

function validateSafetyProfile(profiles, mode) {
	const profile = profiles?.[mode];

	if (profile === undefined) {
		console.error(`Safety profile '${mode}' not configured in .refarm/config.json`);
		return { ok: false };
	}

	if (!Array.isArray(profile)) {
		console.error(`Safety profile '${mode}' is invalid. Expected an array of steps.`);
		return { ok: false };
	}

	const validated = [];
	const invalidSteps = [];
	for (let index = 0; index < profile.length; index += 1) {
		const step = profile[index];
		if (isValidStep(step)) {
			validated.push(step);
			continue;
		}
		invalidSteps.push({ index, step });
	}

	if (validated.length === 0) {
		console.error(`Safety profile '${mode}' has no valid steps.`);
		return { ok: false };
	}

	if (invalidSteps.length > 0) {
		console.warn(`Safety profile '${mode}' contains ${invalidSteps.length} invalid step(s).`);
		for (const invalid of invalidSteps) {
			console.warn(`- step #${invalid.index + 1}: invalid entry`);
		}
	}

	return { ok: true, validated };
}

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const json = argv.includes("--json");
const requiredProfile = !argv.includes("--allow-optional");

const config = loadConfig();
const safetyProfiles = config?.automation?.safety?.profiles ?? {};
const defaultMode = config?.automation?.safety?.defaultProfile;
const positionalModes = argv.filter((arg) => !arg.startsWith("--"));
const mode = positionalModes[0] ?? defaultMode ?? "micro";
const maxDurationMsByProfile = config?.automation?.safety?.maxDurationMsByProfile ?? {};
const configuredMaxDurationMs = Number.isInteger(config?.automation?.safety?.maxDurationMs)
	? config.automation.safety.maxDurationMs
	: null;
const profileMaxDurationMs = Number.isInteger(maxDurationMsByProfile?.[mode])
	? maxDurationMsByProfile[mode]
	: null;
const cliMaxDurationMs = parseMaxDurationMs(argv);

const { ok, validated } = validateSafetyProfile(safetyProfiles, mode);
if (!ok) {
	process.exitCode = 1;
} else {
	await runSafetyGate(mode, {
		strict,
		json,
		requiredProfile,
		maxDurationMs: cliMaxDurationMs ?? profileMaxDurationMs ?? configuredMaxDurationMs,
		profiles: { ...safetyProfiles, [mode]: validated },
	});
}
