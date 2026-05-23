import {
	parseRuntimeAutostartMode,
	RUNTIME_AUTOSTART_MODES,
	RUNTIME_ENGINE_MODES,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	parseOpenExternalLinksMode,
	resolveCliOpenExternalLinksMode,
	type OpenExternalLinksMode,
} from "../utils/open-external-links.js";
import {
	parseTractorEngineMode,
	resolveAutostartMode as resolveRuntimeAutostartMode,
	resolveTractorEngineMode as resolveRuntimeTractorEngineMode,
	type AutostartMode,
	type TractorEngineMode,
} from "../utils/runtime-config.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
} from "./runtime-recovery.js";

type ConfigKey =
	| "farmhand.autostart"
	| "runtime.autostart"
	| "operator.openExternalLinks"
	| "tractor.engine";
interface RefarmCliConfig {
	autostart?: string;
	operator?: {
		openExternalLinks?: string | boolean;
	};
	tractor?: {
		engine?: string;
	};
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

interface JsonOptionCarrier {
	json?: boolean;
	opts?: () => { json?: boolean };
	parent?: {
		opts?: () => { json?: boolean };
	};
}

const CONFIG_KEYS: readonly ConfigKey[] = [
	"runtime.autostart",
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
	const envMode = parseOpenExternalLinksMode(process.env.REFARM_OPEN_EXTERNAL_LINKS);
	if (envMode) return { value: envMode, source: "env:REFARM_OPEN_EXTERNAL_LINKS" };

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
		"REFARM_RUNTIME_AUTOSTART",
		process.env.REFARM_RUNTIME_AUTOSTART,
		AUTOSTART_MODES,
		parseAutostartMode,
	);
	warnIgnoredEnvOverride(
		"REFARM_FARMHAND_AUTOSTART",
		process.env.REFARM_FARMHAND_AUTOSTART,
		AUTOSTART_MODES,
		parseAutostartMode,
	);
}

function warnIgnoredOpenExternalLinksEnvOverride(): void {
	warnIgnoredEnvOverride(
		"REFARM_OPEN_EXTERNAL_LINKS",
		process.env.REFARM_OPEN_EXTERNAL_LINKS,
		OPEN_EXTERNAL_LINKS_ENV_VALUES,
		parseOpenExternalLinksMode,
	);
}

function warnIgnoredTractorEngineEnvOverride(): void {
	warnIgnoredEnvOverride(
		"REFARM_TRACTOR_ENGINE",
		process.env.REFARM_TRACTOR_ENGINE,
		TRACTOR_ENGINE_MODES,
		parseTractorEngineMode,
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
	console.log(JSON.stringify(resolveConfigValue(key, opts, deps), null, 2));
}

function warnIgnoredConfigEnvOverrides(): void {
	warnIgnoredAutostartEnvOverrides();
	warnIgnoredOpenExternalLinksEnvOverride();
	warnIgnoredTractorEngineEnvOverride();
}

function buildConfigSummary(deps: ConfigDeps): ConfigSummary {
	return {
		values: [
			resolveConfigValue("runtime.autostart", {}, deps),
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
	console.log(JSON.stringify(buildConfigSummary(deps), null, 2));
}

function hasJsonOption(opts: JsonOptionCarrier, command?: JsonOptionCarrier): boolean {
	return (
		opts.json === true ||
		opts.opts?.().json === true ||
		command?.opts?.().json === true ||
		command?.parent?.opts?.().json === true
	);
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
	console.log(JSON.stringify(result, null, 2));
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
	console.log(JSON.stringify(result, null, 2));
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
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND} --json
  $ refarm config unset runtime.autostart
  $ refarm config set operator.openExternalLinks never
  $ ${RUNTIME_ENGINE_AUTO_COMMAND}
  $ REFARM_TRACTOR_ENGINE=rust refarm runtime
  $ ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  REFARM_RUNTIME_AUTOSTART can be ${AUTOSTART_MODES_HELP} for one-shot autostart policy.
  REFARM_OPEN_EXTERNAL_LINKS can be ${OPEN_EXTERNAL_LINKS_MODES_HELP} for one-shot link policy.
  REFARM_TRACTOR_ENGINE can be ${TRACTOR_ENGINE_ENV_HELP} for one-shot runtime selection.
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
  $ refarm config get operator.openExternalLinks
  $ refarm config get tractor.engine
  $ refarm config get runtime.autostart --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Without --local, project-local config overrides home config. Environment
  overrides such as REFARM_RUNTIME_AUTOSTART, REFARM_OPEN_EXTERNAL_LINKS, and REFARM_TRACTOR_ENGINE still
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
  $ refarm config unset operator.openExternalLinks --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Unset only changes persisted config. Environment overrides such as
  REFARM_RUNTIME_AUTOSTART still take precedence until removed from the shell.
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
  $ refarm config set operator.openExternalLinks never
  $ refarm config set tractor.engine rust

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (legacy; prefer runtime.autostart)

Notes:
  Use --local for repository-specific operator preferences. Home config is the
  default and applies across Refarm workspaces for the current user.
  For one-shot overrides, use REFARM_RUNTIME_AUTOSTART, REFARM_OPEN_EXTERNAL_LINKS,
  or REFARM_TRACTOR_ENGINE without changing persisted config.
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
