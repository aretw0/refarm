import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import {
	parseRuntimeAutostartMode,
	parseRuntimeEngineMode,
	RUNTIME_AUTOSTART_MODES,
	RUNTIME_ENGINE_MODES,
	type RuntimeAutostartMode,
	type RuntimeEngineMode,
} from "@refarm.dev/runtime";

type ConfigKey =
	| "farmhand.autostart"
	| "runtime.autostart"
	| "operator.openExternalLinks"
	| "tractor.engine";
type OpenExternalLinksMode = "auto" | "never";
type AutostartMode = RuntimeAutostartMode;
type TractorEngineMode = RuntimeEngineMode;

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

function parseOpenExternalLinksMode(value: unknown): OpenExternalLinksMode | null {
	if (value === false) return "never";
	if (value === true) return "auto";
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "never") {
		return "never";
	}
	if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "auto") {
		return "auto";
	}
	return null;
}

function parseTractorEngineMode(value: unknown): TractorEngineMode | null {
	return parseRuntimeEngineMode(value);
}

function resolveAutostartMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: AutostartMode; source: string } {
	const runtimeEnvMode = parseAutostartMode(process.env.REFARM_RUNTIME_AUTOSTART);
	if (runtimeEnvMode) return { value: runtimeEnvMode, source: "env:REFARM_RUNTIME_AUTOSTART" };

	const farmhandEnvMode = parseAutostartMode(process.env.REFARM_FARMHAND_AUTOSTART);
	if (farmhandEnvMode) return { value: farmhandEnvMode, source: "env:REFARM_FARMHAND_AUTOSTART" };

	const paths = opts.local
		? [configPath(deps, { local: true })]
		: [configPath(deps, { local: false }), configPath(deps, { local: true })];
	let resolved: { value: AutostartMode; source: string } | null = null;
	for (const filePath of paths) {
		const mode = parseAutostartMode(readConfig(filePath).autostart);
		if (mode) resolved = { value: mode, source: filePath };
	}
	return resolved ?? { value: "ask", source: "default" };
}

function resolveTractorEngineMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: TractorEngineMode; source: string } {
	const envMode = parseTractorEngineMode(process.env.REFARM_TRACTOR_ENGINE);
	if (envMode) return { value: envMode, source: "env:REFARM_TRACTOR_ENGINE" };

	const paths = opts.local
		? [configPath(deps, { local: true })]
		: [configPath(deps, { local: false }), configPath(deps, { local: true })];
	let resolved: { value: TractorEngineMode; source: string } | null = null;
	for (const filePath of paths) {
		const mode = parseTractorEngineMode(readConfig(filePath).tractor?.engine);
		if (mode) resolved = { value: mode, source: filePath };
	}
	return resolved ?? { value: "auto", source: "default" };
}

function resolveOpenExternalLinksMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: OpenExternalLinksMode; source: string } {
	const envMode = parseOpenExternalLinksMode(process.env.REFARM_OPEN_EXTERNAL_LINKS);
	if (envMode) return { value: envMode, source: "env:REFARM_OPEN_EXTERNAL_LINKS" };

	const paths = opts.local
		? [configPath(deps, { local: true })]
		: [configPath(deps, { local: false }), configPath(deps, { local: true })];
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
	console.log(chalk.dim("  Change a value:       refarm config set runtime.autostart always"));
	console.log(chalk.dim("  Project-local value:  refarm config set runtime.autostart never --local"));
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
  $ refarm config set runtime.autostart always
  $ refarm config set operator.openExternalLinks never
  $ refarm config set tractor.engine auto
  $ REFARM_TRACTOR_ENGINE=rust refarm runtime
  $ refarm config set runtime.autostart never --local

Keys:
  runtime.autostart  ask | always | never
  operator.openExternalLinks  auto | never
  tractor.engine  auto | rust | ts

Legacy aliases:
  farmhand.autostart  ask | always | never  (writes the same autostart setting)

Notes:
  REFARM_TRACTOR_ENGINE can be auto, rust, or ts for one-shot runtime selection.
  Without a subcommand, config currently prints this guide. It is reserved for
  the future interactive configuration surface.
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
  runtime.autostart  ask | always | never
  operator.openExternalLinks  auto | never
  tractor.engine  auto | rust | ts

Legacy aliases:
  farmhand.autostart  ask | always | never  (reads the same autostart setting)

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
  $ refarm config set runtime.autostart always
  $ refarm config set runtime.autostart never --local
  $ refarm config set operator.openExternalLinks never
  $ refarm config set tractor.engine rust

Keys:
  runtime.autostart  ask | always | never
  operator.openExternalLinks  auto | never
  tractor.engine  auto | rust | ts

Legacy aliases:
  farmhand.autostart  ask | always | never  (writes the same autostart setting)

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
