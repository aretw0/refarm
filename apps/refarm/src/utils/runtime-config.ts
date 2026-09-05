import {
	parseRuntimeAutostartMode,
	parseRuntimeEngineMode,
	resolveRuntimeConfigValueAsync,
	resolveRuntimeConfigValueSync,
	type RuntimeAutostartMode,
	type RuntimeConfigLayer,
	type RuntimeConfigValueSpec,
	type RuntimeEngineMode,
} from "@refarm.dev/runtime";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";

export type AutostartMode = RuntimeAutostartMode;
export type TractorEngineMode = RuntimeEngineMode;
export const RUNTIME_AUTOSTART_ENV_VAR = "REFARM_RUNTIME_AUTOSTART";
export const TRACTOR_ENGINE_ENV_VAR = "REFARM_TRACTOR_ENGINE";
export const RUNTIME_SIDECAR_URL_ENV_VAR = "REFARM_SIDECAR_URL";
export const DEFAULT_RUNTIME_SIDECAR_URL = "http://127.0.0.1:42001";

export interface RuntimeConfigDeps {
	cwd?: string;
	home?: string;
	env?: Record<string, string | undefined>;
}

interface RefarmRuntimeConfig extends Record<string, unknown> {
	autostart?: string;
	runtime?: {
		sidecarUrl?: string;
	};
	tractor?: {
		engine?: string;
	};
}

function configPaths(deps: RuntimeConfigDeps, local = false): string[] {
	const cwd = deps.cwd ?? process.cwd();
	if (local) return [path.join(cwd, ".refarm", "config.json")];
	return [path.join(operatorConfigRoot(deps), "config.json"), path.join(cwd, ".refarm", "config.json")];
}

function operatorConfigRoot(deps: RuntimeConfigDeps): string {
	return deps.home
		? path.join(deps.home, ".refarm")
		: resolveRefarmHome(deps.env as NodeJS.ProcessEnv | undefined);
}

function readConfig(filePath: string): RefarmRuntimeConfig {
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RefarmRuntimeConfig;
	} catch {
		return {};
	}
}

export function parseAutostartMode(value: unknown): AutostartMode | null {
	return parseRuntimeAutostartMode(value as string | undefined);
}

export function parseTractorEngineMode(value: unknown): TractorEngineMode | null {
	return parseRuntimeEngineMode(value);
}

export function normalizeRuntimeSidecarUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

export function parseRuntimeSidecarUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = normalizeRuntimeSidecarUrl(value);
	if (normalized.length === 0) return null;
	try {
		const parsed = new URL(normalized);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return normalized;
	} catch {
		return null;
	}
}

export function resolveAutostartMode(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: AutostartMode; source: string } {
	return resolveRuntimeConfigValueSync(AUTOSTART_SPEC, configValueSyncOptions(deps, options));
}

export function resolveTractorEngineMode(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: TractorEngineMode; source: string } {
	return resolveRuntimeConfigValueSync(TRACTOR_ENGINE_SPEC, configValueSyncOptions(deps, options));
}

export function resolveRuntimeSidecarUrl(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: string; source: string } {
	return resolveRuntimeConfigValueSync(SIDECAR_URL_SPEC, configValueSyncOptions(deps, options));
}

/**
 * Node-aware variant of {@link resolveRuntimeSidecarUrl}, symmetric to the Rust
 * host — refactored onto the shared {@link resolveRuntimeConfigValueAsync} (behavior
 * identical to the prior inline impl). The sync resolver stays fs-only and
 * untouched for callers that report "which file".
 */
export async function resolveRuntimeSidecarUrlAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: string; source: string }> {
	return resolveRuntimeConfigValueAsync(
		SIDECAR_URL_SPEC,
		configValueAsyncOptions(resolveConfig, deps, options),
	);
}

/**
 * Node-aware variant of {@link resolveAutostartMode}, matching the sync
 * resolver's env/config/default ordering.
 */
export async function resolveAutostartModeAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: AutostartMode; source: string }> {
	return resolveRuntimeConfigValueAsync(
		AUTOSTART_SPEC,
		configValueAsyncOptions(resolveConfig, deps, options),
	);
}

/** Node-aware variant of {@link resolveTractorEngineMode} (nested `tractor.engine`). */
export async function resolveTractorEngineModeAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: TractorEngineMode; source: string }> {
	return resolveRuntimeConfigValueAsync(
		TRACTOR_ENGINE_SPEC,
		configValueAsyncOptions(resolveConfig, deps, options),
	);
}

const AUTOSTART_SPEC: RuntimeConfigValueSpec<AutostartMode> = {
	envProbes: [{ name: RUNTIME_AUTOSTART_ENV_VAR, parse: parseAutostartMode }],
	extract: (cfg) => cfg?.autostart,
	parse: parseAutostartMode,
	default: "ask",
};

const TRACTOR_ENGINE_SPEC: RuntimeConfigValueSpec<TractorEngineMode> = {
	envProbes: [{ name: TRACTOR_ENGINE_ENV_VAR, parse: parseTractorEngineMode }],
	extract: (cfg) => (cfg?.tractor as { engine?: unknown } | undefined)?.engine,
	parse: parseTractorEngineMode,
	default: "auto",
};

const SIDECAR_URL_SPEC: RuntimeConfigValueSpec<string> = {
	envProbes: [{ name: RUNTIME_SIDECAR_URL_ENV_VAR, parse: parseRuntimeSidecarUrl }],
	extract: (cfg) => (cfg?.runtime as { sidecarUrl?: unknown } | undefined)?.sidecarUrl,
	parse: parseRuntimeSidecarUrl,
	default: DEFAULT_RUNTIME_SIDECAR_URL,
};

function configValueSyncOptions(
	deps: RuntimeConfigDeps,
	options: { local?: boolean },
): {
	env: Record<string, string | undefined>;
	configs: RefarmRuntimeConfig[];
	configSources: string[];
} {
	const paths = configPaths(deps, options.local);
	return {
		env: deps.env ?? process.env,
		configs: paths.map(readConfig),
		configSources: paths,
	};
}

function configValueAsyncOptions(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps,
	options: { local?: boolean },
): {
	env: Record<string, string | undefined>;
	resolveConfig: () => Promise<Record<string, unknown> | null>;
	hostConfigSource: string;
	fallbackConfigs: RuntimeConfigLayer[];
} {
	return {
		env: deps.env ?? process.env,
		resolveConfig,
		hostConfigSource: "sovereign-config",
		fallbackConfigs: homeConfigFallback(deps, options),
	};
}

function homeConfigFallback(
	deps: RuntimeConfigDeps,
	options: { local?: boolean },
): RuntimeConfigLayer[] {
	if (options.local) return [];
	return [
		{
			value: readConfig(path.join(operatorConfigRoot(deps), "config.json")) as Record<string, unknown>,
			source: "home",
		},
	];
}
