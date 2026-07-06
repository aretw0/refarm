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
export const RUNTIME_SIDECAR_URL_ENV_VAR = "REFARM_SIDECAR_URL";
export const DEFAULT_RUNTIME_SIDECAR_URL = "http://127.0.0.1:42001";

export interface RuntimeConfigDeps {
	cwd?: string;
	home?: string;
	env?: Record<string, string | undefined>;
}

interface RefarmRuntimeConfig {
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

export function resolveRuntimeSidecarUrl(
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): { value: string; source: string } {
	const env = deps.env ?? process.env;
	const envUrl = parseRuntimeSidecarUrl(env[RUNTIME_SIDECAR_URL_ENV_VAR]);
	if (envUrl) return { value: envUrl, source: `env:${RUNTIME_SIDECAR_URL_ENV_VAR}` };

	let resolved: { value: string; source: string } | null = null;
	for (const filePath of configPaths(deps, options.local)) {
		const sidecarUrl = parseRuntimeSidecarUrl(readConfig(filePath).runtime?.sidecarUrl);
		if (sidecarUrl) resolved = { value: sidecarUrl, source: filePath };
	}
	return { value: resolved?.value ?? DEFAULT_RUNTIME_SIDECAR_URL, source: resolved?.source ?? "default" };
}

/**
 * Ordered env probe: a var name plus the parser that validates its value. Probes
 * fire in array order; the first that parses to non-null wins. Autostart uses TWO
 * probes (primary + legacy FARMHAND); sidecar/engine use one.
 */
interface EnvProbe<T> {
	name: string;
	parse: (value: string | undefined) => T | null;
}

interface ConfigValueSpec<T> {
	/** Ordered env probes; first non-null wins, source becomes `env:<name>`. */
	envProbes: ReadonlyArray<EnvProbe<T>>;
	/**
	 * Pull the raw candidate out of a sovereign config object — the exact key path
	 * per scalar: cfg.autostart (top-level) / cfg.tractor.engine /
	 * cfg.runtime.sidecarUrl (nested). A function so the key path is data, not
	 * branching.
	 */
	extract: (cfg: Record<string, unknown> | null | undefined) => unknown;
	/** Validate/normalize the extracted or env candidate to T (or null). */
	parse: (value: unknown) => T | null;
	/** Terminal fallback when no layer yields a value. */
	default: T;
}

/**
 * Node-aware resolution shared by every sovereign-scalar async resolver.
 *
 * PRECEDENCE (identical to the sidecar reference, byte-for-byte behavior):
 *   1. env probes, in order            → source `env:<name>`
 *   2. seam: resolveConfig() (cwd fs-first, then the cwd-scoped graph node)
 *                                       → source `sovereign-config`
 *   3. home `~/.refarm/config.json` fs  → source `home`   (skipped when local)
 *   4. spec.default                     → source `default`
 *
 * The seam is consulted BEFORE the home fs fallback on purpose. The sync
 * resolvers loop `[home, cwd]` last-wins, so cwd beats home; the seam is the cwd
 * layer (fs-first, node-fallback), so it must win over home to preserve that
 * precedence. This is the exact inversion the adversarial caught on the sidecar
 * draft — encoded here ONCE so no per-scalar twin can regress it.
 *
 * `resolveConfig` is INJECTED, keeping runtime-config.ts storage-free; the app
 * passes `() => resolveSovereignConfig(env)` (which owns the tractor-db read). The
 * home read reuses the same `readConfig` + `.refarm/config.json` join the sync
 * path uses — one fs semantics, no second reader.
 */
export async function resolveConfigValueAsync<T>(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	spec: ConfigValueSpec<T>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: T; source: string }> {
	// 1. env probes, in declared order — first non-null wins.
	const env = deps.env ?? process.env;
	for (const probe of spec.envProbes) {
		const parsed = probe.parse(env[probe.name]);
		if (parsed != null) return { value: parsed, source: `env:${probe.name}` };
	}

	// 2. seam (cwd fs-first / cwd-scoped node) — MUST precede the home fallback.
	const cfg = await resolveConfig();
	const cwdValue = spec.parse(spec.extract(cfg));
	if (cwdValue != null) return { value: cwdValue, source: "sovereign-config" };

	// 3. home fs fallback — the node cannot represent the home layer, so it is a
	//    pure fs read, consulted only when the cwd/node layer had nothing, and only
	//    when not scoped to a local (cwd-only) lookup.
	if (!options.local) {
		const home = deps.home ?? os.homedir();
		const homeCfg = readConfig(
			path.join(home, ".refarm", "config.json"),
		) as Record<string, unknown>;
		const homeValue = spec.parse(spec.extract(homeCfg));
		if (homeValue != null) return { value: homeValue, source: "home" };
	}

	// 4. terminal default.
	return { value: spec.default, source: "default" };
}

/**
 * Node-aware variant of {@link resolveRuntimeSidecarUrl}, symmetric to the Rust
 * host — refactored onto the shared {@link resolveConfigValueAsync} (behavior
 * identical to the prior inline impl). The sync resolver stays fs-only and
 * untouched for callers that report "which file".
 */
export async function resolveRuntimeSidecarUrlAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: string; source: string }> {
	return resolveConfigValueAsync<string>(
		resolveConfig,
		{
			envProbes: [
				{ name: RUNTIME_SIDECAR_URL_ENV_VAR, parse: parseRuntimeSidecarUrl },
			],
			extract: (cfg) =>
				(cfg?.runtime as { sidecarUrl?: unknown } | undefined)?.sidecarUrl,
			parse: parseRuntimeSidecarUrl,
			default: DEFAULT_RUNTIME_SIDECAR_URL,
		},
		deps,
		options,
	);
}

/**
 * Node-aware variant of {@link resolveAutostartMode}. Two env probes (primary
 * then legacy FARMHAND), matching the sync resolver's ordered env checks.
 */
export async function resolveAutostartModeAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: AutostartMode; source: string }> {
	return resolveConfigValueAsync<AutostartMode>(
		resolveConfig,
		{
			envProbes: [
				{ name: RUNTIME_AUTOSTART_ENV_VAR, parse: parseAutostartMode },
				{ name: LEGACY_FARMHAND_AUTOSTART_ENV_VAR, parse: parseAutostartMode },
			],
			extract: (cfg) => cfg?.autostart,
			parse: parseAutostartMode,
			default: "ask",
		},
		deps,
		options,
	);
}

/** Node-aware variant of {@link resolveTractorEngineMode} (nested `tractor.engine`). */
export async function resolveTractorEngineModeAsync(
	resolveConfig: () => Promise<Record<string, unknown> | null>,
	deps: RuntimeConfigDeps = {},
	options: { local?: boolean } = {},
): Promise<{ value: TractorEngineMode; source: string }> {
	return resolveConfigValueAsync<TractorEngineMode>(
		resolveConfig,
		{
			envProbes: [
				{ name: TRACTOR_ENGINE_ENV_VAR, parse: parseTractorEngineMode },
			],
			extract: (cfg) =>
				(cfg?.tractor as { engine?: unknown } | undefined)?.engine,
			parse: parseTractorEngineMode,
			default: "auto",
		},
		deps,
		options,
	);
}
