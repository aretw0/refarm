import {
	parseRuntimeAutostartMode,
	parseRuntimeEngineMode,
	type RuntimeAutostartMode,
	type RuntimeEngineMode,
} from "@refarm.dev/runtime";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AutostartMode = RuntimeAutostartMode;
export type TractorEngineMode = RuntimeEngineMode;
export const RUNTIME_AUTOSTART_ENV_VAR = "REFARM_RUNTIME_AUTOSTART";
export const LEGACY_FARMHAND_AUTOSTART_ENV_VAR = "REFARM_FARMHAND_AUTOSTART";
export const TRACTOR_ENGINE_ENV_VAR = "REFARM_TRACTOR_ENGINE";

export interface RuntimeConfigDeps {
	cwd?: string;
	home?: string;
	env?: Record<string, string | undefined>;
}

interface RefarmRuntimeConfig {
	autostart?: string;
	tractor?: {
		engine?: string;
	};
}

function configPaths(deps: RuntimeConfigDeps, local = false): string[] {
	const cwd = deps.cwd ?? process.cwd();
	const home = deps.home ?? os.homedir();
	if (local) return [path.join(cwd, ".refarm", "config.json")];
	return [
		path.join(home, ".refarm", "config.json"),
		path.join(cwd, ".refarm", "config.json"),
	];
}

function readConfig(filePath: string): RefarmRuntimeConfig {
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RefarmRuntimeConfig;
	} catch {
		return {};
	}
}

export function parseAutostartMode(value: string | undefined): AutostartMode | null {
	return parseRuntimeAutostartMode(value);
}

export function parseTractorEngineMode(value: unknown): TractorEngineMode | null {
	return parseRuntimeEngineMode(value);
}

export function resolveAutostartMode(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: AutostartMode; source: string } {
	const env = deps.env ?? process.env;
	const runtimeEnvMode = parseAutostartMode(env[RUNTIME_AUTOSTART_ENV_VAR]);
	if (runtimeEnvMode) return { value: runtimeEnvMode, source: `env:${RUNTIME_AUTOSTART_ENV_VAR}` };

	const farmhandEnvMode = parseAutostartMode(env[LEGACY_FARMHAND_AUTOSTART_ENV_VAR]);
	if (farmhandEnvMode) return { value: farmhandEnvMode, source: `env:${LEGACY_FARMHAND_AUTOSTART_ENV_VAR}` };

	let resolved: { value: AutostartMode; source: string } | null = null;
	for (const filePath of configPaths(deps, options.local)) {
		const mode = parseAutostartMode(readConfig(filePath).autostart);
		if (mode) resolved = { value: mode, source: filePath };
	}
	return resolved ?? { value: "ask", source: "default" };
}

export function resolveTractorEngineMode(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: TractorEngineMode; source: string } {
	const env = deps.env ?? process.env;
	const envMode = parseTractorEngineMode(env[TRACTOR_ENGINE_ENV_VAR]);
	if (envMode) return { value: envMode, source: `env:${TRACTOR_ENGINE_ENV_VAR}` };

	let resolved: { value: TractorEngineMode; source: string } | null = null;
	for (const filePath of configPaths(deps, options.local)) {
		const mode = parseTractorEngineMode(readConfig(filePath).tractor?.engine);
		if (mode) resolved = { value: mode, source: filePath };
	}
	return resolved ?? { value: "auto", source: "default" };
}
