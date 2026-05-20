import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import type { AutostartMode } from "./session-launch.js";

type ConfigKey = "farmhand.autostart" | "operator.openExternalLinks";
type OpenExternalLinksMode = "auto" | "never";

interface RefarmCliConfig {
	autostart?: string;
	operator?: {
		openExternalLinks?: string | boolean;
	};
}

interface ConfigDeps {
	cwd(): string;
	home(): string;
}

const CONFIG_KEYS: readonly ConfigKey[] = [
	"farmhand.autostart",
	"operator.openExternalLinks",
];
const AUTOSTART_MODES: readonly AutostartMode[] = ["ask", "always", "never"];
const OPEN_EXTERNAL_LINKS_MODES: readonly OpenExternalLinksMode[] = ["auto", "never"];

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
	return value === "ask" || value === "always" || value === "never"
		? value
		: null;
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

function resolveAutostartMode(
	deps: ConfigDeps,
	opts: { local?: boolean },
): { value: AutostartMode; source: string } {
	const envMode = parseAutostartMode(process.env.REFARM_FARMHAND_AUTOSTART);
	if (envMode) return { value: envMode, source: "env:REFARM_FARMHAND_AUTOSTART" };

	const paths = opts.local
		? [configPath(deps, { local: true })]
		: [configPath(deps, { local: false }), configPath(deps, { local: true })];
	for (const filePath of paths) {
		const mode = parseAutostartMode(readConfig(filePath).autostart);
		if (mode) return { value: mode, source: filePath };
	}
	return { value: "ask", source: "default" };
}

function assertConfigKey(value: string): asserts value is ConfigKey {
	if ((CONFIG_KEYS as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Unknown config key: ${value}`));
	console.error(chalk.dim(`   Use: ${CONFIG_KEYS.join(", ")}`));
	process.exit(1);
}

function assertAutostartMode(value: string): asserts value is AutostartMode {
	if ((AUTOSTART_MODES as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Invalid farmhand.autostart: ${value}`));
	console.error(chalk.dim(`   Use: ${AUTOSTART_MODES.join(", ")}`));
	process.exit(1);
}

function assertOpenExternalLinksMode(value: string): asserts value is OpenExternalLinksMode {
	if ((OPEN_EXTERNAL_LINKS_MODES as readonly string[]).includes(value)) return;
	console.error(chalk.red(`✗  Invalid operator.openExternalLinks: ${value}`));
	console.error(chalk.dim(`   Use: ${OPEN_EXTERNAL_LINKS_MODES.join(", ")}`));
	process.exit(1);
}

function printConfigValue(key: ConfigKey, opts: { local?: boolean }, deps: ConfigDeps): void {
	if (key === "farmhand.autostart") {
		const effective = resolveAutostartMode(deps, opts);
		console.log(`${key}=${effective.value}`);
		console.log(chalk.dim(`source=${effective.source}`));
		return;
	}
	if (key === "operator.openExternalLinks") {
		const filePath = configPath(deps, opts);
		const mode = parseOpenExternalLinksMode(readConfig(filePath).operator?.openExternalLinks) ?? "auto";
		console.log(`${key}=${mode}`);
		console.log(chalk.dim(`source=${mode === "auto" ? "default" : filePath}`));
	}
}

function setConfigValue(
	key: ConfigKey,
	value: string,
	opts: { local?: boolean },
	deps: ConfigDeps,
): void {
	if (key === "farmhand.autostart") {
		assertAutostartMode(value);
		const filePath = configPath(deps, opts);
		const config = readConfig(filePath);
		config.autostart = value;
		writeConfig(filePath, config);
		console.log(chalk.green(`✓  ${key}=${value}`));
		console.log(chalk.dim(`   ${filePath}`));
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
  $ refarm config get farmhand.autostart
  $ refarm config set farmhand.autostart always
  $ refarm config set operator.openExternalLinks never
  $ refarm config set farmhand.autostart never --local

Keys:
  farmhand.autostart  ask | always | never
  operator.openExternalLinks  auto | never

Notes:
  Without a subcommand, config currently prints this guide. It is reserved for
  the future interactive configuration surface.
`,
		)
		.action(() => {
			console.log(chalk.bold("Refarm config"));
			console.log(chalk.dim("  Use get/set today; interactive config is reserved for this command."));
			console.log("");
			console.log(chalk.dim("  refarm config get farmhand.autostart"));
			console.log(chalk.dim("  refarm config set farmhand.autostart always"));
			console.log(chalk.dim("  refarm config set operator.openExternalLinks never"));
		})
		.addCommand(
			new Command("get")
				.description("Show an effective config value")
				.argument("<key>", "Config key")
				.option("--local", "Read project-local .refarm/config.json only")
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
				.action((key: string, value: string, opts: { local?: boolean }) => {
					assertConfigKey(key);
					setConfigValue(key, value, opts, deps);
				}),
		);
}

export const configCommand = createConfigCommand();
