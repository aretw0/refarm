import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/cli/json-output";
import { parseRuntimeAutostartMode, RUNTIME_AUTOSTART_MODES, RUNTIME_ENGINE_MODES, } from "@refarm.dev/runtime";
import type { LedgerScope } from "@refarm.dev/storage-node-view";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	compositionScopePath,
	resolveComposition,
	type ResolvedPackageSource,
} from "../utils/composition-resolver.js";
import {
	getSource,
	type PackageSource,
	type SurfaceKey,
} from "../utils/composition.js";
import {
	OPEN_EXTERNAL_LINKS_ENV_VAR, parseOpenExternalLinksMode, resolveCliOpenExternalLinksMode, type OpenExternalLinksMode,
} from "../utils/open-external-links.js";
import {
	LEGACY_FARMHAND_AUTOSTART_ENV_VAR, parseRuntimeSidecarUrl, parseTractorEngineMode, resolveAutostartMode as resolveRuntimeAutostartMode, resolveRuntimeSidecarUrl, resolveTractorEngineMode as resolveRuntimeTractorEngineMode, RUNTIME_AUTOSTART_ENV_VAR, RUNTIME_SIDECAR_URL_ENV_VAR, TRACTOR_ENGINE_ENV_VAR, type AutostartMode, type TractorEngineMode,
} from "../utils/runtime-config.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
} from "./runtime-recovery.js";

const CONFIG_JSON_COMMAND = refarmCommand(["config", "--json"]);

type ConfigKey =
	| "farmhand.autostart"
	| "runtime.autostart"
	| "runtime.sidecarUrl"
	| "operator.openExternalLinks"
	| "tractor.engine";
interface RefarmCliConfig {
	autostart?: string;
	MODEL_HISTORY_TURNS?: string;
	MODEL_STREAM_RESPONSES?: string;
	MODEL_TOOL_CALL_MAX_ITER?: string;
	operator?: {
		openExternalLinks?: string | boolean;
	};
	runtime?: {
		sidecarUrl?: string;
	};
	tractor?: {
		engine?: string;
	};
	/**
	 * The COMPOSITION layer: which packages this scope activates, with pi-style
	 * `!`-surface suppression. Additive and deliberately NOT a `ConfigKey` — it is
	 * a LIST, not a scalar, so it stays out of the `config get/set/unset` grammar
	 * and is authored via the `config plugins` subcommands. The scalar RMW path
	 * reads+writes the whole object, so it co-habits this file untouched.
	 */
	plugins?: PackageSource[];
}

interface ConfigDeps {
	cwd(): string;
	home(): string;
}

interface EffectiveConfigValue {
	key: ConfigKey;
	value: string;
	source: string;
	legacy?: boolean;
}

interface ConfigSummary {
	values: EffectiveConfigValue[];
}

interface PersistedConfigValue {
	key: ConfigKey;
	value: string;
	path: string;
	scope: "home" | "local";
	legacy?: boolean;
}

interface UnsetConfigValue {
	key: ConfigKey;
	path: string;
	scope: "home" | "local";
	removed: boolean;
	legacy?: boolean;
}

interface AppliedConfigProfile {
	profile: "coding";
	path: string;
	scope: "home" | "local";
	values: Record<string, string>;
}

interface JsonOptionCarrier {
	json?: boolean;
	opts?: () => { json?: boolean };
	/** The parent command in the chain — recursive so `hasJsonOption` can walk to
	 * an ancestor that owns a `--json` declared higher up (e.g. `config --json`). */
	parent?: JsonOptionCarrier;
}

const CONFIG_KEYS: readonly ConfigKey[] = [
	"runtime.autostart",
	"runtime.sidecarUrl",
	"operator.openExternalLinks",
	"tractor.engine",
	"farmhand.autostart",
];
const AUTOSTART_MODES = RUNTIME_AUTOSTART_MODES;
const OPEN_EXTERNAL_LINKS_MODES: readonly OpenExternalLinksMode[] = ["auto", "never"];
const TRACTOR_ENGINE_MODES = RUNTIME_ENGINE_MODES;
const AUTOSTART_MODES_HELP = AUTOSTART_MODES.join(" | ");
const OPEN_EXTERNAL_LINKS_MODES_HELP = OPEN_EXTERNAL_LINKS_MODES.join(" | ");
const OPEN_EXTERNAL_LINKS_ENV_VALUES: readonly string[] = [
	...OPEN_EXTERNAL_LINKS_MODES,
	"true",
	"false",
	"on",
	"off",
	"1",
	"0",
];
const TRACTOR_ENGINE_MODES_HELP = TRACTOR_ENGINE_MODES.join(" | ");
const TRACTOR_ENGINE_ENV_HELP = TRACTOR_ENGINE_MODES.join(", ");
const CODING_PROFILE_VALUES = {
	MODEL_HISTORY_TURNS: "20",
	MODEL_TOOL_CALL_MAX_ITER: "20",
	MODEL_STREAM_RESPONSES: "1",
} as const;

function defaultDeps(): ConfigDeps {
	return {
		cwd: () => process.cwd(),
		home: () => os.homedir(),
	};
}

function configPath(deps: ConfigDeps, opts: { local?: boolean }): string {
	const base = opts.local ? deps.cwd() : deps.home();
	return path.join(base, ".refarm", "config.json");
}

function readConfig(filePath: string): RefarmCliConfig {
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RefarmCliConfig;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read ${filePath}: ${message}`);
	}
}

function writeConfig(filePath: string, config: RefarmCliConfig): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function parseAutostartMode(value: string | undefined): AutostartMode | null {
	return parseRuntimeAutostartMode(value);
}

function resolveAutostartMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: AutostartMode; source: string } {
	return resolveRuntimeAutostartMode(
		{ cwd: deps.cwd(), home: deps.home(), env: process.env },
		opts,
	);
}

function resolveTractorEngineMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: TractorEngineMode; source: string } {
	return resolveRuntimeTractorEngineMode(
		{ cwd: deps.cwd(), home: deps.home(), env: process.env },
		opts,
	);
}

function resolveOpenExternalLinksMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: OpenExternalLinksMode; source: string } {
	const envMode = parseOpenExternalLinksMode(process.env[OPEN_EXTERNAL_LINKS_ENV_VAR]);
	if (envMode) return { value: envMode, source: `env:${OPEN_EXTERNAL_LINKS_ENV_VAR}` };

	if (!opts.local) {
		return resolveCliOpenExternalLinksMode({
			cwd: deps.cwd(),
			home: deps.home(),
			env: {},
		}) ?? { value: "auto", source: "default" };
	}

	const paths = [configPath(deps, { local: true })];
	let resolved: { value: OpenExternalLinksMode; source: string } | null = null;
	for (const filePath of paths) {
		const mode = parseOpenExternalLinksMode(readConfig(filePath).operator?.openExternalLinks);
		if (mode) resolved = { value: mode, source: filePath };
	}
	return resolved ?? { value: "auto", source: "default" };
}

function resolveSidecarUrl(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: string; source: string } {
	return resolveRuntimeSidecarUrl(
		{ cwd: deps.cwd(), home: deps.home(), env: process.env },
		opts,
	);
}

function parseConfigKey(value: string): ConfigKey | null {
	if ((CONFIG_KEYS as readonly string[]).includes(value)) return value as ConfigKey;
	console.error(chalk.red(`✗  Unknown config key: ${value}`));
	console.error(chalk.dim(`   Use: ${CONFIG_KEYS.join(", ")}`));
	process.exitCode = 1;
	return null;
}

function parseConfigAutostartMode(
	key: Extract<ConfigKey, "farmhand.autostart" | "runtime.autostart">,
	value: string,
): AutostartMode | null {
	const mode = parseAutostartMode(value);
	if (mode) return mode;
	console.error(chalk.red(`✗  Invalid ${key}: ${value}`));
	console.error(chalk.dim(`   Use: ${AUTOSTART_MODES.join(", ")}`));
	process.exitCode = 1;
	return null;
}

function parseConfigOpenExternalLinksMode(value: string): OpenExternalLinksMode | null {
	if ((OPEN_EXTERNAL_LINKS_MODES as readonly string[]).includes(value)) {
		return value as OpenExternalLinksMode;
	}
	console.error(chalk.red(`✗  Invalid operator.openExternalLinks: ${value}`));
	console.error(chalk.dim(`   Use: ${OPEN_EXTERNAL_LINKS_MODES.join(", ")}`));
	process.exitCode = 1;
	return null;
}

function parseConfigTractorEngineMode(value: string): TractorEngineMode | null {
	const mode = parseTractorEngineMode(value);
	if (mode) return mode;
	console.error(chalk.red(`✗  Invalid tractor.engine: ${value}`));
	console.error(chalk.dim(`   Use: ${TRACTOR_ENGINE_MODES.join(", ")}`));
	process.exitCode = 1;
	return null;
}

function parseConfigSidecarUrl(value: string): string | null {
	const sidecarUrl = parseRuntimeSidecarUrl(value);
	if (sidecarUrl) return sidecarUrl;
	console.error(chalk.red(`✗  Invalid runtime.sidecarUrl: ${value}`));
	console.error(chalk.dim("   Use an http:// or https:// URL, for example http://127.0.0.1:42001"));
	process.exitCode = 1;
	return null;
}

function warnIgnoredEnvOverride(
	name: string,
	value: string | undefined,
	valid: readonly string[],
	parse: (value: string | undefined) => unknown,
): void {
	if (value === undefined || parse(value)) return;
	console.error(chalk.yellow(`⚠  Ignored invalid ${name}=${value}`));
	console.error(chalk.dim(`   Use: ${valid.join(", ")}`));
}

function warnIgnoredAutostartEnvOverrides(): void {
	warnIgnoredEnvOverride(
		RUNTIME_AUTOSTART_ENV_VAR,
		process.env[RUNTIME_AUTOSTART_ENV_VAR],
		AUTOSTART_MODES,
		parseAutostartMode,
	);
	warnIgnoredEnvOverride(
		LEGACY_FARMHAND_AUTOSTART_ENV_VAR,
		process.env[LEGACY_FARMHAND_AUTOSTART_ENV_VAR],
		AUTOSTART_MODES,
		parseAutostartMode,
	);
}

function warnIgnoredOpenExternalLinksEnvOverride(): void {
	warnIgnoredEnvOverride(
		OPEN_EXTERNAL_LINKS_ENV_VAR,
		process.env[OPEN_EXTERNAL_LINKS_ENV_VAR],
		OPEN_EXTERNAL_LINKS_ENV_VALUES,
		parseOpenExternalLinksMode,
	);
}

function warnIgnoredTractorEngineEnvOverride(): void {
	warnIgnoredEnvOverride(
		TRACTOR_ENGINE_ENV_VAR,
		process.env[TRACTOR_ENGINE_ENV_VAR],
		TRACTOR_ENGINE_MODES,
		parseTractorEngineMode,
	);
}

function warnIgnoredSidecarUrlEnvOverride(): void {
	warnIgnoredEnvOverride(
		RUNTIME_SIDECAR_URL_ENV_VAR,
		process.env[RUNTIME_SIDECAR_URL_ENV_VAR],
		["http://127.0.0.1:42001"],
		parseRuntimeSidecarUrl,
	);
}

function resolveConfigValue(
	key: ConfigKey,
	opts: { local?: boolean },
	deps: ConfigDeps,
): EffectiveConfigValue {
	if (key === "farmhand.autostart" || key === "runtime.autostart") {
		const effective = resolveAutostartMode(deps, opts);
		return {
			key,
			value: effective.value,
			source: effective.source,
			...(key === "farmhand.autostart" ? { legacy: true } : {}),
		};
	}
	if (key === "operator.openExternalLinks") {
		const effective = resolveOpenExternalLinksMode(deps, opts);
		return { key, value: effective.value, source: effective.source };
	}
	if (key === "runtime.sidecarUrl") {
		const effective = resolveSidecarUrl(deps, opts);
		return { key, value: effective.value, source: effective.source };
	}
	const effective = resolveTractorEngineMode(deps, opts);
	return { key, value: effective.value, source: effective.source };
}

function printConfigValue(key: ConfigKey, opts: { local?: boolean }, deps: ConfigDeps): void {
	warnIgnoredConfigEnvOverrides();
	const effective = resolveConfigValue(key, opts, deps);
	console.log(`${effective.key}=${effective.value}`);
	console.log(chalk.dim(`source=${effective.source}`));
	if (effective.legacy) {
		console.log(chalk.dim("legacy key; prefer runtime.autostart"));
	}
}

function printConfigValueJson(key: ConfigKey, opts: { local?: boolean }, deps: ConfigDeps): void {
	warnIgnoredConfigEnvOverrides();
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "get",
			extra: resolveConfigValue(key, opts, deps),
		}),
	);
}

function warnIgnoredConfigEnvOverrides(): void {
	warnIgnoredAutostartEnvOverrides();
	warnIgnoredOpenExternalLinksEnvOverride();
	warnIgnoredTractorEngineEnvOverride();
	warnIgnoredSidecarUrlEnvOverride();
}

function buildConfigSummary(deps: ConfigDeps): ConfigSummary {
	return {
		values: [
			resolveConfigValue("runtime.autostart", {}, deps),
			resolveConfigValue("runtime.sidecarUrl", {}, deps),
			resolveConfigValue("operator.openExternalLinks", {}, deps),
			resolveConfigValue("tractor.engine", {}, deps),
		],
	};
}

function printConfigSummary(deps: ConfigDeps): void {
	warnIgnoredConfigEnvOverrides();
	const summary = buildConfigSummary(deps);

	console.log(chalk.bold("Refarm config"));
	for (const item of summary.values) {
		console.log(`  ${item.key}=${item.value}`);
		console.log(chalk.dim(`    source=${item.source}`));
	}
	console.log("");
	console.log(chalk.dim(`  Change a value:       ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.log(chalk.dim(`  Project-local value:  ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local`));
	console.log(chalk.dim("  Future: running this command without arguments can become interactive."));
}

function printConfigSummaryJson(deps: ConfigDeps): void {
	warnIgnoredConfigEnvOverrides();
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "summary",
			extra: buildConfigSummary(deps),
		}),
	);
}

function hasJsonOption(opts: JsonOptionCarrier, command?: JsonOptionCarrier): boolean {
	if (opts.json === true || opts.opts?.().json === true) return true;
	// Walk the full ancestor chain: commander attaches a `--json` declared on an
	// ancestor (e.g. the top-level `config --json`) to THAT command, so a nested
	// grandchild (`config plugins list`) must look past its immediate parent.
	let node: JsonOptionCarrier | undefined = command;
	while (node) {
		if (node.opts?.().json === true) return true;
		node = node.parent;
	}
	return false;
}

function configScope(opts: { local?: boolean }): "home" | "local" {
	return opts.local ? "local" : "home";
}

function printPersistedConfigValue(result: PersistedConfigValue): void {
	console.log(chalk.green(`✓  ${result.key}=${result.value}`));
	console.log(chalk.dim(`   ${result.path}`));
	if (result.legacy) {
		console.log(chalk.dim("   legacy key; prefer runtime.autostart"));
	}
}

function printPersistedConfigValueJson(result: PersistedConfigValue): void {
	const nextCommand = configGetCommand(result.key, { local: result.scope === "local" });
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "set",
			extra: result,
			nextCommand,
			nextCommands: [nextCommand],
		}),
	);
}

function printUnsetConfigValue(result: UnsetConfigValue): void {
	if (result.removed) {
		console.log(chalk.green(`✓  unset ${result.key}`));
	} else {
		console.log(chalk.dim(`-  ${result.key} was not set`));
	}
	console.log(chalk.dim(`   ${result.path}`));
	if (result.legacy) {
		console.log(chalk.dim("   legacy key; prefer runtime.autostart"));
	}
}

function printUnsetConfigValueJson(result: UnsetConfigValue): void {
	const nextCommand = configGetCommand(result.key, { local: result.scope === "local" });
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "unset",
			extra: result,
			nextCommand,
			nextCommands: [nextCommand],
		}),
	);
}

function configGetCommand(key: ConfigKey, opts: { local?: boolean }): string {
	return refarmCommand([
		"config",
		"get",
		key,
		"--json",
		...(opts.local ? ["--local"] : []),
	]);
}

function applyConfigProfile(
	profile: string,
	opts: { local?: boolean },
	deps: ConfigDeps,
): AppliedConfigProfile | null {
	if (profile !== "coding") {
		console.error(chalk.red(`✗  Unknown config profile: ${profile}`));
		console.error(chalk.dim("   Use: coding"));
		process.exitCode = 1;
		return null;
	}
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	const values = { ...CODING_PROFILE_VALUES };
	Object.assign(config, values);
	writeConfig(filePath, config);
	return {
		profile,
		path: filePath,
		scope: configScope(opts),
		values,
	};
}

function printAppliedConfigProfile(result: AppliedConfigProfile): void {
	console.log(chalk.green(`✓  ${result.profile} profile applied`));
	console.log(chalk.dim(`   ${result.path}`));
	for (const [key, value] of Object.entries(result.values)) {
		console.log(`   ${key}=${value}`);
	}
}

function printAppliedConfigProfileJson(result: AppliedConfigProfile): void {
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "profile",
			extra: result,
			nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextCommands: [RUNTIME_ENSURE_WAIT_NEXT_COMMAND, CONFIG_JSON_COMMAND],
		}),
	);
}

function persistConfigValue(
	key: ConfigKey,
	value: string,
	opts: { local?: boolean },
	deps: ConfigDeps,
): PersistedConfigValue | null {
	if (key === "farmhand.autostart" || key === "runtime.autostart") {
		const mode = parseConfigAutostartMode(key, value);
		if (!mode) return null;
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.autostart = mode;
		writeConfig(filePath, config);
		return {
			key,
			value: mode,
			path: filePath,
			scope: configScope(opts),
			...(key === "farmhand.autostart" ? { legacy: true } : {}),
		};
	}
	if (key === "operator.openExternalLinks") {
		const mode = parseConfigOpenExternalLinksMode(value);
		if (!mode) return null;
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.operator = {
			...(config.operator ?? {}),
			openExternalLinks: mode,
		};
		writeConfig(filePath, config);
		return {
			key,
			value: mode,
			path: filePath,
			scope: configScope(opts),
		};
	}
	if (key === "runtime.sidecarUrl") {
		const sidecarUrl = parseConfigSidecarUrl(value);
		if (!sidecarUrl) return null;
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.runtime = {
			...(config.runtime ?? {}),
			sidecarUrl,
		};
		writeConfig(filePath, config);
		return {
			key,
			value: sidecarUrl,
			path: filePath,
			scope: configScope(opts),
		};
	}
	if (key === "tractor.engine") {
		const mode = parseConfigTractorEngineMode(value);
		if (!mode) return null;
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.tractor = {
			...(config.tractor ?? {}),
			engine: mode,
		};
		writeConfig(filePath, config);
		return {
			key,
			value: mode,
			path: filePath,
			scope: configScope(opts),
		};
	}
	return null;
}

function unsetConfigValue(
	key: ConfigKey,
	opts: { local?: boolean },
	deps: ConfigDeps,
): UnsetConfigValue {
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	let removed = false;

	if (key === "farmhand.autostart" || key === "runtime.autostart") {
		removed = Object.prototype.hasOwnProperty.call(config, "autostart");
		if (removed) {
			delete config.autostart;
		}
	} else if (key === "operator.openExternalLinks") {
		removed = Object.prototype.hasOwnProperty.call(
			config.operator ?? {},
			"openExternalLinks",
		);
		if (removed && config.operator) {
			delete config.operator.openExternalLinks;
		}
	} else if (key === "runtime.sidecarUrl") {
		removed = Object.prototype.hasOwnProperty.call(config.runtime ?? {}, "sidecarUrl");
		if (removed && config.runtime) {
			delete config.runtime.sidecarUrl;
		}
	} else if (key === "tractor.engine") {
		removed = Object.prototype.hasOwnProperty.call(config.tractor ?? {}, "engine");
		if (removed && config.tractor) {
			delete config.tractor.engine;
		}
	}

	if (removed) {
		writeConfig(filePath, config);
	}

	return {
		key,
		path: filePath,
		scope: configScope(opts),
		removed,
		...(key === "farmhand.autostart" ? { legacy: true } : {}),
	};
}

// ── Composition layer (`config plugins`) ───────────────────────────────────
// The plugins[] LIST is a different concern from the scalar config keys: it is
// the COMPOSITION declaration (which packages a scope activates + pi-style
// suppression), authored via this subgroup rather than `config set`. It lives in
// the SAME config.json but never enters the ConfigKey grammar.

const CONFIG_PLUGINS_LIST_JSON_COMMAND = refarmCommand([
	"config",
	"plugins",
	"list",
	"--json",
]);

const SURFACE_KEYS: readonly SurfaceKey[] = [
	"skills",
	"tools",
	"themes",
	"commands",
];

/** Parse a --scope value for a composition write; null when unrecognized. */
function parseCompositionScope(
	value: string | undefined,
): LedgerScope | null {
	if (value === undefined) return "user";
	return value === "org" || value === "workspace" || value === "user"
		? value
		: null;
}

/** Project a resolved composition entry for output, expanding its suppression
 * into a per-surface effective view when `effective` is requested. */
function projectCompositionEntry(
	resolved: ResolvedPackageSource,
	effective: boolean,
) {
	const { entry, source, scope } = resolved;
	const base = { source, scope, form: typeof entry === "string" ? "bare" : "object" };
	if (!effective || typeof entry === "string") return base;
	// For an object entry, surface the declared patterns and whether the surface
	// is fully active, fully suppressed, or filtered — the "what's actually on".
	const surfaces: Record<string, { patterns: string[]; allActive: boolean }> = {};
	for (const key of SURFACE_KEYS) {
		const patterns = entry[key];
		if (patterns === undefined) continue; // absent = all active, nothing to show
		surfaces[key] = {
			patterns: [...patterns],
			// All-active only when the surface key is absent; a present array filters.
			allActive: false,
		};
	}
	return { ...base, surfaces };
}

export function buildCompositionListEnvelope(
	deps: ConfigDeps,
	opts: {
		scope?: string;
		effective?: boolean;
		env?: Record<string, string | undefined>;
	},
) {
	const scope = parseCompositionScope(opts.scope);
	if (opts.scope !== undefined && !scope) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: "plugins.list",
			error: "unknown-scope",
			message: `Unknown scope "${opts.scope}". Use org | workspace | user.`,
			nextAction: "Re-run with --scope org, workspace, or user.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	// The resolver folds all active tiers; --scope only filters the VIEW (it does
	// not change what is read, so an org entry inherited into effect still shows).
	const resolution = resolveComposition({
		cwd: deps.cwd(),
		home: deps.home(),
		...(opts.env ? { env: opts.env } : {}),
	});
	const activeScopes = resolution.consulted.map((c) => c.scope);
	// Guard --scope org when the org tier is not active (no REFARM_ORG_HOME).
	if (scope === "org" && !activeScopes.includes("org")) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: "plugins.list",
			error: "org-scope-unavailable",
			message:
				"The org scope is not active. Set REFARM_ORG_HOME to a shared org base to use --scope org.",
			nextAction:
				"Set REFARM_ORG_HOME to a shared org base, or omit --scope org.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const entries = resolution.plugins
		.filter((p) => (opts.scope === undefined ? true : p.scope === scope))
		.map((p) => projectCompositionEntry(p, opts.effective === true));
	return buildJsonSuccessEnvelope({
		command: "config",
		operation: "plugins.list",
		extra: {
			plugins: entries,
			count: entries.length,
			scopesConsulted: activeScopes,
			effective: opts.effective === true,
		},
	});
}

function printCompositionList(
	deps: ConfigDeps,
	opts: { scope?: string; effective?: boolean },
): void {
	const envelope = buildCompositionListEnvelope(deps, opts) as {
		ok: boolean;
		error?: string;
		message?: string;
		plugins?: { source: string; scope: string; form: string }[];
		count?: number;
	};
	if (!envelope.ok) {
		console.error(chalk.red(`✗  ${envelope.message ?? envelope.error}`));
		return;
	}
	if ((envelope.count ?? 0) === 0) {
		console.log(chalk.dim("No composed packages. Add one with:"));
		console.log("  refarm config plugins add <source>");
		return;
	}
	console.log(chalk.bold(`Composed packages (${envelope.count}):`));
	for (const p of envelope.plugins ?? []) {
		console.log(
			`  ${chalk.cyan(p.source)}  ${chalk.dim(`[${p.scope}]`)}  ${chalk.dim(p.form)}`,
		);
	}
}

/**
 * Add or remove a bare-string composition entry at ONE scope, via read-modify-
 * write on that scope's config.json (reusing the scalar path's readConfig/
 * writeConfig, so scalar siblings are preserved). `add` is idempotent by source
 * (Set-union: re-adding an existing source is a no-op, and NEVER downgrades an
 * existing object entry to a bare string). `remove` DE-DECLARES — it drops the
 * entry from this scope's list; it is NOT a physical uninstall (that is
 * `refarm plugin` / barn). Returns a handoff envelope.
 */
export function buildCompositionMutationEnvelope(
	deps: ConfigDeps,
	op: "add" | "remove",
	source: string,
	opts: {
		scope?: string;
		env?: Record<string, string | undefined>;
	} = {},
) {
	const scope = parseCompositionScope(opts.scope);
	if (opts.scope !== undefined && !scope) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "unknown-scope",
			message: `Unknown scope "${opts.scope}". Use org | workspace | user.`,
			nextAction: "Re-run with --scope org, workspace, or user.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const trimmed = source.trim();
	if (!trimmed) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "empty-source",
			message: "A package source must be a non-empty string.",
			nextAction: "Pass a source, e.g. `config plugins add @refarm/agent`.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const filePath = compositionScopePath(scope ?? "user", {
		cwd: deps.cwd(),
		home: deps.home(),
		...(opts.env ? { env: opts.env } : {}),
	});
	if (!filePath) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "org-scope-unavailable",
			message:
				"The org scope is not active. Set REFARM_ORG_HOME to a shared org base to write there.",
			nextAction:
				"Set REFARM_ORG_HOME to a shared org base, or omit --scope org.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}

	const config = readConfig(filePath);
	const before = config.plugins ?? [];
	const existingIndex = before.findIndex((entry) => getSource(entry) === trimmed);
	let changed = false;
	let plugins = before;
	if (op === "add") {
		if (existingIndex === -1) {
			// Idempotent Set-union: only append when the source is not already
			// present. An existing object entry is left intact (never downgraded).
			plugins = [...before, trimmed];
			changed = true;
		}
	} else {
		if (existingIndex !== -1) {
			plugins = before.filter((entry) => getSource(entry) !== trimmed);
			changed = true;
		}
	}
	if (changed) {
		writeConfig(filePath, { ...config, plugins });
	}

	return buildJsonSuccessEnvelope({
		command: "config",
		operation: `plugins.${op}`,
		extra: {
			source: trimmed,
			scope: scope ?? "user",
			path: filePath,
			changed,
			// The de-declare vs uninstall distinction, surfaced on the contract.
			...(op === "remove"
				? { note: "de-declared from composition (not a physical uninstall)" }
				: {}),
		},
		nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
	});
}

function printCompositionMutation(
	deps: ConfigDeps,
	op: "add" | "remove",
	source: string,
	opts: { scope?: string },
): void {
	const envelope = buildCompositionMutationEnvelope(deps, op, source, opts) as {
		ok: boolean;
		error?: string;
		message?: string;
		source?: string;
		scope?: string;
		path?: string;
		changed?: boolean;
	};
	if (!envelope.ok) {
		console.error(chalk.red(`✗  ${envelope.message ?? envelope.error}`));
		return;
	}
	const verb = op === "add" ? "added" : "removed";
	if (!envelope.changed) {
		const already = op === "add" ? "already present" : "not present";
		console.log(chalk.dim(`•  ${envelope.source} ${already} in [${envelope.scope}] — no change`));
		return;
	}
	console.log(chalk.green(`✓  ${verb} ${envelope.source}  [${envelope.scope}]`));
	console.log(chalk.dim(`   ${envelope.path}`));
	if (op === "remove") {
		console.log(chalk.dim("   de-declared from composition (not a physical uninstall)"));
	}
}

/**
 * The `config plugins` subgroup — the COMPOSITION authoring surface. It is under
 * `config` (beside `profile`), NOT under the top-level `plugin` command: `plugin`
 * manages the PHYSICAL runtime plugin lifecycle (barn/npm/WASM install/reload),
 * while this declares which packages a scope ACTIVATES. Two different meanings of
 * "plugin"; keeping composition under `config` avoids the semantic collision.
 */
function createConfigPluginsCommand(deps: ConfigDeps): Command {
	return new Command("plugins")
		.description("Inspect the composed packages a scope activates")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm config plugins list
  $ refarm config plugins list --json
  $ refarm config plugins list --effective
  $ refarm config plugins list --scope workspace

Notes:
  Composition (which packages are activated + surface suppression) is distinct
  from \`refarm plugin\` (which physically installs/reloads runtime plugins).
  Entries fold org < workspace < user; the user copy of a source wins.
`,
		)
		.addCommand(
			new Command("list")
				.description("List the effective composed packages, folded across scopes")
				.option("--scope <scope>", "Filter the view to org | workspace | user")
				.option(
					"--effective",
					"Expand each entry's surface suppression (what is actually on)",
				)
				.option("--json", "Output machine-readable composition list")
				.action(
					(
						opts: {
							scope?: string;
							effective?: boolean;
						} & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(buildCompositionListEnvelope(deps, opts));
							return;
						}
						printCompositionList(deps, opts);
					},
				),
		)
		.addCommand(
			new Command("add")
				.description("Activate a package in a scope's composition (idempotent)")
				.argument("<source>", "Package source: npm:@scope/pkg | ../path | id")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						opts: { scope?: string } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionMutationEnvelope(deps, "add", source, opts),
							);
							return;
						}
						printCompositionMutation(deps, "add", source, opts);
					},
				),
		)
		.addCommand(
			new Command("remove")
				.alias("rm")
				.description(
					"De-declare a package from a scope's composition (NOT a physical uninstall)",
				)
				.argument("<source>", "Package source to drop from this scope")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						opts: { scope?: string } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionMutationEnvelope(deps, "remove", source, opts),
							);
							return;
						}
						printCompositionMutation(deps, "remove", source, opts);
					},
				),
		);
}

export function createConfigCommand(deps: ConfigDeps = defaultDeps()): Command {
	return new Command("config")
		.description("Inspect and change refarm CLI preferences")
		.option("--json", "Output effective config values as JSON")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm config
  $ refarm config --json
  $ refarm config get runtime.autostart
  $ refarm config get runtime.autostart --json
  $ refarm config get runtime.sidecarUrl --json
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND} --json
  $ refarm config unset runtime.autostart
  $ refarm config set runtime.sidecarUrl http://127.0.0.1:42001 --local
  $ refarm config set operator.openExternalLinks never
  $ refarm config profile coding --local --json
  $ ${RUNTIME_ENGINE_AUTO_COMMAND}
  $ ${TRACTOR_ENGINE_ENV_VAR}=rust refarm runtime
  $ ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  runtime.sidecarUrl  HTTP endpoint for the selected runtime sidecar
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Profiles:
  coding  MODEL_HISTORY_TURNS=20, MODEL_TOOL_CALL_MAX_ITER=20, MODEL_STREAM_RESPONSES=1

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  ${RUNTIME_AUTOSTART_ENV_VAR} can be ${AUTOSTART_MODES_HELP} for one-shot autostart policy.
  ${RUNTIME_SIDECAR_URL_ENV_VAR} can point one command at a different runtime sidecar.
  ${OPEN_EXTERNAL_LINKS_ENV_VAR} can be ${OPEN_EXTERNAL_LINKS_MODES_HELP} for one-shot link policy.
  ${TRACTOR_ENGINE_ENV_VAR} can be ${TRACTOR_ENGINE_ENV_HELP} for one-shot runtime selection.
  Without a subcommand, config prints the effective values and their sources.
  The no-argument form is reserved for the future interactive configuration surface.
`,
		)
		.action((opts: JsonOptionCarrier, command: JsonOptionCarrier) => {
			if (hasJsonOption(opts, command)) {
				printConfigSummaryJson(deps);
				return;
			}
			printConfigSummary(deps);
		})
		.addCommand(
			new Command("profile")
				.description("Apply a named Refarm runtime profile")
				.argument("<name>", "Profile name")
				.option("--local", "Update project-local .refarm/config.json")
				.option("--json", "Output machine-readable profile result")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm config profile coding --local
  $ refarm config profile coding --local --json

Profiles:
  coding  Enables agent coding defaults for this scope:
          MODEL_HISTORY_TURNS=20
          MODEL_TOOL_CALL_MAX_ITER=20
          MODEL_STREAM_RESPONSES=1

Notes:
  Farmhand reads these values from ~/.refarm/config.json and ./.refarm/config.json
  at runtime startup. Use --local for repository-specific agent behavior.
  Restart or ensure the runtime after applying a profile.
`,
				)
				.action(
					(
						profile: string,
						opts: { local?: boolean } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						const result = applyConfigProfile(profile, opts, deps);
						if (!result) return;
						if (hasJsonOption(opts, command)) {
							printAppliedConfigProfileJson(result);
							return;
						}
						printAppliedConfigProfile(result);
					},
				),
		)
		.addCommand(createConfigPluginsCommand(deps))
		.addCommand(
			new Command("get")
				.description("Show an effective config value")
				.argument("<key>", "Config key")
				.option("--local", "Read project-local .refarm/config.json only")
				.option("--json", "Output machine-readable key/value/source")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm config get runtime.autostart
  $ refarm config get runtime.autostart --json
  $ refarm config get runtime.sidecarUrl --json
  $ refarm config get operator.openExternalLinks
  $ refarm config get tractor.engine
  $ refarm config get runtime.autostart --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  runtime.sidecarUrl  HTTP endpoint for the selected runtime sidecar
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Without --local, project-local config overrides home config. Environment
  overrides such as ${RUNTIME_AUTOSTART_ENV_VAR}, ${OPEN_EXTERNAL_LINKS_ENV_VAR}, and ${TRACTOR_ENGINE_ENV_VAR} still
  take precedence and are shown in the source line.
`,
				)
				.action(
					(
						key: string,
						opts: { local?: boolean } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						const parsedKey = parseConfigKey(key);
						if (!parsedKey) return;
						if (hasJsonOption(opts, command)) {
							printConfigValueJson(parsedKey, opts, deps);
							return;
						}
						printConfigValue(parsedKey, opts, deps);
					},
				),
		)
		.addCommand(
			new Command("unset")
				.description("Remove a persisted config value so defaults or environment can apply")
				.argument("<key>", "Config key")
				.option("--local", "Update project-local .refarm/config.json")
				.option("--json", "Output machine-readable unset result")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm config unset runtime.autostart
  $ refarm config unset runtime.autostart --json
  $ refarm config unset runtime.sidecarUrl --local
  $ refarm config unset operator.openExternalLinks --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  runtime.sidecarUrl  HTTP endpoint for the selected runtime sidecar
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Unset only changes persisted config. Environment overrides such as
  ${RUNTIME_AUTOSTART_ENV_VAR} still take precedence until removed from the shell.
`,
				)
				.action(
					(
						key: string,
						opts: { local?: boolean } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						const parsedKey = parseConfigKey(key);
						if (!parsedKey) return;
						const result = unsetConfigValue(parsedKey, opts, deps);
						if (hasJsonOption(opts, command)) {
							printUnsetConfigValueJson(result);
							return;
						}
						printUnsetConfigValue(result);
					},
				),
		)
		.addCommand(
			new Command("set")
				.description("Persist a config value")
				.argument("<key>", "Config key")
				.argument("<value>", "Config value")
				.option("--local", "Write project-local .refarm/config.json")
				.option("--json", "Output machine-readable persisted value")
				.addHelpText(
					"after",
					`

Examples:
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND} --json
  $ ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local
  $ refarm config set runtime.sidecarUrl http://127.0.0.1:42001 --local
  $ refarm config set operator.openExternalLinks never
  $ refarm config set tractor.engine rust

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  runtime.sidecarUrl  HTTP endpoint for the selected runtime sidecar
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Use --local for repository-specific operator preferences. Home config is the
  default and applies across Refarm workspaces for the current user.
  For one-shot overrides, use ${RUNTIME_AUTOSTART_ENV_VAR}, ${OPEN_EXTERNAL_LINKS_ENV_VAR},
  or ${TRACTOR_ENGINE_ENV_VAR} without changing persisted config.
`,
				)
				.action(
					(
						key: string,
						value: string,
						opts: { local?: boolean } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						const parsedKey = parseConfigKey(key);
						if (!parsedKey) return;
						const result = persistConfigValue(parsedKey, value, opts, deps);
						if (!result) return;
						if (hasJsonOption(opts, command)) {
							printPersistedConfigValueJson(result);
							return;
						}
						printPersistedConfigValue(result);
					},
				),
		);
}

export const configCommand = createConfigCommand();
