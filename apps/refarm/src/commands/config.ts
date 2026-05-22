import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import {
	parseRuntimeAutostartMode,
	RUNTIME_AUTOSTART_MODES,
	RUNTIME_ENGINE_MODES,
} from "@refarm.dev/runtime";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
} from "./runtime-recovery.js";
import {
	parseOpenExternalLinksMode,
	resolveCliOpenExternalLinksMode,
	type OpenExternalLinksMode,
} from "../utils/open-external-links.js";
import {
	resolveAutostartMode as resolveRuntimeAutostartMode,
	resolveTractorEngineMode as resolveRuntimeTractorEngineMode,
	type AutostartMode,
	type TractorEngineMode,
} from "../utils/runtime-config.js";

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

function assertConfigKey(value: string): asserts value is ConfigKey {
	if ((CONFIG_KEYS as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Unknown config key: ${value}`));
	console.error(chalk.dim(`   Use: ${CONFIG_KEYS.join(", ")}`));
	process.exit(1);
}

function assertAutostartMode(key: Extract<ConfigKey, "farmhand.autostart" | "runtime.autostart">, value: string): asserts value is AutostartMode {
	if ((AUTOSTART_MODES as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Invalid ${key}: ${value}`));
	console.error(chalk.dim(`   Use: ${AUTOSTART_MODES.join(", ")}`));
	process.exit(1);
}

function assertOpenExternalLinksMode(value: string): asserts value is OpenExternalLinksMode {
	if ((OPEN_EXTERNAL_LINKS_MODES as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Invalid operator.openExternalLinks: ${value}`));
	console.error(chalk.dim(`   Use: ${OPEN_EXTERNAL_LINKS_MODES.join(", ")}`));
	process.exit(1);
}

function assertTractorEngineMode(value: string): asserts value is TractorEngineMode {
	if ((TRACTOR_ENGINE_MODES as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Invalid tractor.engine: ${value}`));
	console.error(chalk.dim(`   Use: ${TRACTOR_ENGINE_MODES.join(", ")}`));
	process.exit(1);
}

function printConfigValue(key: ConfigKey, opts: { local?: boolean }, deps: ConfigDeps): void {
	if (key === "farmhand.autostart" || key === "runtime.autostart") {
		const effective = resolveAutostartMode(deps, opts);
		console.log(`${key}=${effective.value}`);
		console.log(chalk.dim(`source=${effective.source}`));
		if (key === "farmhand.autostart") {
			console.log(chalk.dim("legacy key; prefer runtime.autostart"));
		}
		return;
	}
	if (key === "operator.openExternalLinks") {
		const effective = resolveOpenExternalLinksMode(deps, opts);
		console.log(`${key}=${effective.value}`);
		console.log(chalk.dim(`source=${effective.source}`));
		return;
	}
	if (key === "tractor.engine") {
		const effective = resolveTractorEngineMode(deps, opts);
		console.log(`${key}=${effective.value}`);
		console.log(chalk.dim(`source=${effective.source}`));
	}
}

function printConfigSummary(deps: ConfigDeps): void {
	const runtimeAutostart = resolveAutostartMode(deps, {});
	const externalLinks = resolveOpenExternalLinksMode(deps, {});
	const tractorEngine = resolveTractorEngineMode(deps, {});

	console.log(chalk.bold("Refarm config"));
	console.log(`  runtime.autostart=${runtimeAutostart.value}`);
	console.log(chalk.dim(`    source=${runtimeAutostart.source}`));
	console.log(`  operator.openExternalLinks=${externalLinks.value}`);
	console.log(chalk.dim(`    source=${externalLinks.source}`));
	console.log(`  tractor.engine=${tractorEngine.value}`);
	console.log(chalk.dim(`    source=${tractorEngine.source}`));
	console.log("");
	console.log(chalk.dim(`  Change a value:       ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.log(chalk.dim(`  Project-local value:  ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local`));
	console.log(chalk.dim("  Future: running this command without arguments can become interactive."));
}

function setConfigValue(
	key: ConfigKey,
	value: string,
	opts: { local?: boolean },
	deps: ConfigDeps,
): void {
	if (key === "farmhand.autostart" || key === "runtime.autostart") {
		assertAutostartMode(key, value);
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.autostart = value;
		writeConfig(filePath, config);
		console.log(chalk.green(`✓  ${key}=${value}`));
		console.log(chalk.dim(`   ${filePath}`));
		if (key === "farmhand.autostart") {
			console.log(chalk.dim("   legacy key; prefer runtime.autostart"));
		}
		return;
	}
	if (key === "operator.openExternalLinks") {
		assertOpenExternalLinksMode(value);
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.operator = {
			...(config.operator ?? {}),
			openExternalLinks: value,
		};
		writeConfig(filePath, config);
		console.log(chalk.green(`✓  ${key}=${value}`));
		console.log(chalk.dim(`   ${filePath}`));
		return;
	}
	if (key === "tractor.engine") {
		assertTractorEngineMode(value);
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.tractor = {
			...(config.tractor ?? {}),
			engine: value,
		};
		writeConfig(filePath, config);
		console.log(chalk.green(`✓  ${key}=${value}`));
		console.log(chalk.dim(`   ${filePath}`));
	}
}

export function createConfigCommand(deps: ConfigDeps = defaultDeps()): Command {
	return new Command("config")
		.description("Inspect and change refarm CLI preferences")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm config
  $ refarm config get runtime.autostart
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  $ refarm config set operator.openExternalLinks never
  $ ${RUNTIME_ENGINE_AUTO_COMMAND}
  $ REFARM_TRACTOR_ENGINE=rust refarm runtime
  $ ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (writes the same autostart setting)

Notes:
  REFARM_TRACTOR_ENGINE can be ${TRACTOR_ENGINE_ENV_HELP} for one-shot runtime selection.
  Without a subcommand, config prints the effective values and their sources.
  The no-argument form is reserved for the future interactive configuration surface.
`,
		)
		.action(() => {
			printConfigSummary(deps);
		})
		.addCommand(
			new Command("get")
				.description("Show an effective config value")
				.argument("<key>", "Config key")
				.option("--local", "Read project-local .refarm/config.json only")
				.addHelpText(
					"after",
					`

Examples:
  $ refarm config get runtime.autostart
  $ refarm config get operator.openExternalLinks
  $ refarm config get tractor.engine
  $ refarm config get runtime.autostart --local

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (reads the same autostart setting)

Notes:
  Without --local, project-local config overrides home config. Environment
  overrides such as REFARM_RUNTIME_AUTOSTART and REFARM_TRACTOR_ENGINE still
  take precedence and are shown in the source line.
`,
				)
				.action((key: string, opts: { local?: boolean }) => {
					assertConfigKey(key);
					printConfigValue(key, opts, deps);
				}),
		)
		.addCommand(
			new Command("set")
				.description("Persist a config value")
				.argument("<key>", "Config key")
				.argument("<value>", "Config value")
				.option("--local", "Write project-local .refarm/config.json")
				.addHelpText(
					"after",
					`

Examples:
  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}
  $ ${RUNTIME_AUTOSTART_NEVER_COMMAND} --local
  $ refarm config set operator.openExternalLinks never
  $ refarm config set tractor.engine rust

Keys:
  runtime.autostart  ${AUTOSTART_MODES_HELP}
  operator.openExternalLinks  ${OPEN_EXTERNAL_LINKS_MODES_HELP}
  tractor.engine  ${TRACTOR_ENGINE_MODES_HELP}

Legacy aliases:
  farmhand.autostart  ${AUTOSTART_MODES_HELP}  (writes the same autostart setting)

Notes:
  Use --local for repository-specific operator preferences. Home config is the
  default and applies across Refarm workspaces for the current user.
`,
				)
				.action((key: string, value: string, opts: { local?: boolean }) => {
					assertConfigKey(key);
					setConfigValue(key, value, opts, deps);
				}),
		);
}

export const configCommand = createConfigCommand();
