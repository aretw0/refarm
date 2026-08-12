import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	parseRuntimeAutostartMode,
	RUNTIME_AUTOSTART_MODES,
	RUNTIME_ENGINE_MODES,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { Command } from "commander";

import { declaredBase } from "@refarm.dev/config";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import {
	OPEN_EXTERNAL_LINKS_ENV_VAR,
	parseOpenExternalLinksMode,
	resolveCliOpenExternalLinksMode,
	type OpenExternalLinksMode,
} from "../utils/open-external-links.js";
import {
	parseRuntimeSidecarUrl,
	parseTractorEngineMode,
	resolveAutostartMode as resolveRuntimeAutostartMode,
	resolveRuntimeSidecarUrl,
	resolveTractorEngineMode as resolveRuntimeTractorEngineMode,
	RUNTIME_AUTOSTART_ENV_VAR,
	RUNTIME_SIDECAR_URL_ENV_VAR,
	TRACTOR_ENGINE_ENV_VAR,
	type AutostartMode,
	type TractorEngineMode,
} from "../utils/runtime-config.js";
import { CommandRefusal, guardedAction, type RefusalHandoff } from "./action-boundary.js";
import { createConfigPluginsCommand } from "./config-plugins.js";
import {
	buildConfigHistory,
	CONFIG_SET_KIND,
	CONFIG_UNSET_KIND,
	configTrailPath,
	readConfigSnapshot,
	readConfigTrail,
	recordConfigMutation,
	undoConfigOperation,
	type ConfigHistoryEntry,
	type ConfigRecordDeps,
} from "./config-record.js";
import {
	hasJsonOption,
	hasLocalOption,
	readConfig,
	serializeConfig,
	writeConfig,
	type ConfigDeps,
	type JsonOptionCarrier,
	type RefarmCliConfig,
} from "./config-shared.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_AUTOSTART_NEVER_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
} from "./runtime-recovery.js";

export {
	buildCompositionListEnvelope,
	buildCompositionMutationEnvelope,
	buildCompositionSuppressEnvelope,
} from "./config-plugins.js";

const CONFIG_JSON_COMMAND = refarmCommand(["config", "--json"]);
const CONFIG_HISTORY_JSON_COMMAND = refarmCommand(["config", "history", "--json"]);

/** The handoff a refused `config <operation>` carries. `refarm config --json` is the honest
 *  next step for every one of them: it prints the effective values and their sources, which
 *  is what an operator (or an agent) needs after being told a key, value or profile was not
 *  recognized. */
function configRefusalHandoff(
	operation: string,
	nextCommand = CONFIG_JSON_COMMAND,
): RefusalHandoff {
	return {
		command: "config",
		operation,
		error: "config-invalid-request",
		nextAction: `Inspect the effective config with \`${nextCommand}\`.`,
		nextCommand,
		nextCommands: [nextCommand],
	};
}

/** Commander hands an action `(...arguments, options, command)`. `--json` may be bound to
 *  EITHER the subcommand or its parent (both declare it), so the boundary reads it the same
 *  way every other `config` path does — through `hasJsonOption`. */
function configActionJson(...args: unknown[]): boolean {
	return hasJsonOption(args.at(-2) as JsonOptionCarrier, args.at(-1) as JsonOptionCarrier);
}

type ConfigKey =
	| "runtime.autostart"
	| "runtime.sidecarUrl"
	| "operator.openExternalLinks"
	| "tractor.engine";

interface EffectiveConfigValue {
	key: ConfigKey;
	value: string;
	source: string;
}

interface ConfigSummary {
	values: EffectiveConfigValue[];
}

interface PersistedConfigValue {
	key: ConfigKey;
	value: string;
	path: string;
	scope: "home" | "local";
	/** The operation record this change was remembered as — the handle `config history undo`
	 *  takes. Printed, not merely stored: a record the operator cannot address is a log. */
	recordId: string;
}

interface UnsetConfigValue {
	key: ConfigKey;
	path: string;
	scope: "home" | "local";
	removed: boolean;
	/** `null` when nothing was set, so nothing changed and nothing was recorded. */
	recordId: string | null;
}

/** The options a MUTATING config subcommand accepts. `why` is the operator's own reason, carried
 *  verbatim into the record — R3 wants "why", and the only honest source of it is the person
 *  making the change. It is NOT a confirmation and NOT required. */
interface ConfigMutationOptions {
	local?: boolean;
	why?: string;
}

interface AppliedConfigProfile {
	profile: "coding";
	path: string;
	scope: "home" | "local";
	values: Record<string, string>;
}

const CONFIG_KEYS: readonly ConfigKey[] = [
	"runtime.autostart",
	"runtime.sidecarUrl",
	"operator.openExternalLinks",
	"tractor.engine",
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
const MAX_SPAWN_ENV_PATH_ENTRIES = 64;
const MAX_SPAWN_ENV_PATH_ENTRY_LENGTH = 4096;
const MAX_SPAWN_ENV_PATH_TOTAL_LENGTH = 64 * 1024;

interface SpawnEnvResult {
	path: string[];
	home: string | null;
	configPath: string;
	scope: "home" | "local";
	recordId?: string;
}

function defaultDeps(): ConfigDeps {
	return {
		cwd: () => process.cwd(),
		// ISS-102: the DECLARED base, not the OS home. This and
		// `composition-resolver.ts`'s user tier must land on the same file — scalars live here,
		// `plugins[]` lives there, and the composition layer depends on it being ONE file. They
		// were both anchored on `os.homedir()`, which kept them consistent and kept them wrong
		// under any declared home. They move together or not at all, which is why this pair
		// changed in one commit with a test pinning them to the same path.
		home: () => declaredBase(),
	};
}

function configPath(deps: ConfigDeps, opts: { local?: boolean }): string {
	const base = opts.local ? deps.cwd() : deps.home();
	return path.join(base, ".refarm", "config.json");
}

function validateSpawnEnvPath(value: string, field: string): string {
	if (!value || value.length > MAX_SPAWN_ENV_PATH_ENTRY_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new CommandRefusal(
			"invalid-config-value",
			`Invalid ${field}: paths must be non-empty, control-free, and at most ${MAX_SPAWN_ENV_PATH_ENTRY_LENGTH} characters.`,
			"Use an absolute filesystem path.",
		);
	}
	if (!path.isAbsolute(value)) {
		throw new CommandRefusal(
			"invalid-config-value",
			`Invalid ${field}: ${value}`,
			"Use an absolute filesystem path.",
		);
	}
	return path.normalize(value);
}

function parseSpawnEnv(pathEntries: readonly string[], home: string | undefined) {
	if (pathEntries.length === 0 || pathEntries.length > MAX_SPAWN_ENV_PATH_ENTRIES) {
		throw new CommandRefusal(
			"invalid-config-value",
			`spawnEnv.path must contain between 1 and ${MAX_SPAWN_ENV_PATH_ENTRIES} entries.`,
			"Name the executable search directories in deliberate order.",
		);
	}
	const parsedPath = pathEntries.map((entry, index) =>
		validateSpawnEnvPath(entry, `spawnEnv.path[${index}]`),
	);
	if (parsedPath.reduce((total, entry) => total + entry.length, 0) > MAX_SPAWN_ENV_PATH_TOTAL_LENGTH) {
		throw new CommandRefusal(
			"invalid-config-value",
			`spawnEnv.path exceeds ${MAX_SPAWN_ENV_PATH_TOTAL_LENGTH} total characters.`,
			"Declare a smaller executable search path.",
		);
	}
	return {
		path: parsedPath,
		...(home ? { home: validateSpawnEnvPath(home, "spawnEnv.home") } : {}),
	};
}

function readSpawnEnv(opts: { local?: boolean }, deps: ConfigDeps): SpawnEnvResult {
	const filePath = configPath(deps, opts);
	const spawnEnv = readConfig(filePath).spawnEnv;
	return {
		path: Array.isArray(spawnEnv?.path) ? [...spawnEnv.path] : [],
		home: typeof spawnEnv?.home === "string" ? spawnEnv.home : null,
		configPath: filePath,
		scope: configScope(opts),
	};
}

async function setSpawnEnv(
	pathEntries: readonly string[],
	opts: ConfigMutationOptions & { home?: string },
	deps: ConfigDeps,
	recordDeps: ConfigRecordDeps,
): Promise<SpawnEnvResult> {
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	const spawnEnv = parseSpawnEnv(pathEntries, opts.home);
	config.spawnEnv = spawnEnv;
	const record = await recordConfigMutation(
		{
			kind: CONFIG_SET_KIND,
			key: "spawnEnv",
			value: JSON.stringify(spawnEnv),
			scope: configScope(opts),
			filePath,
			before: readConfigSnapshot(filePath),
			after: serializeConfig(config),
			why: opts.why,
			requestedAt: (recordDeps.now ?? (() => new Date().toISOString()))(),
		},
		recordDeps,
	);
	return { path: spawnEnv.path, home: spawnEnv.home ?? null, configPath: filePath, scope: configScope(opts), recordId: record.id };
}

async function unsetSpawnEnv(
	opts: ConfigMutationOptions,
	deps: ConfigDeps,
	recordDeps: ConfigRecordDeps,
): Promise<SpawnEnvResult & { removed: boolean }> {
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	const before = readConfigSnapshot(filePath);
	const removed = Object.prototype.hasOwnProperty.call(config, "spawnEnv");
	if (!removed) return { ...readSpawnEnv(opts, deps), removed };
	delete config.spawnEnv;
	const record = await recordConfigMutation(
		{
			kind: CONFIG_UNSET_KIND,
			key: "spawnEnv",
			scope: configScope(opts),
			filePath,
			before,
			after: serializeConfig(config),
			why: opts.why,
			requestedAt: (recordDeps.now ?? (() => new Date().toISOString()))(),
		},
		recordDeps,
	);
	return { path: [], home: null, configPath: filePath, scope: configScope(opts), recordId: record.id, removed };
}

function printSpawnEnv(result: SpawnEnvResult): void {
	console.log(chalk.bold("Refarm spawn environment"));
	console.log(chalk.dim(`  ${result.configPath}`));
	console.log(`  PATH: ${result.path.length ? result.path.join(path.delimiter) : "(undeclared)"}`);
	console.log(`  HOME: ${result.home ?? "(undeclared)"}`);
	if (result.recordId) console.log(chalk.dim(`  recorded — undo with \`refarm config history undo ${result.recordId}${result.scope === "local" ? " --local" : ""}\``));
}

function printSpawnEnvJson(operation: string, result: SpawnEnvResult): void {
	printJson(buildJsonSuccessEnvelope({
		command: "config",
		operation,
		extra: result,
		nextCommand: refarmCommand(["config", "spawn-env", "--json", ...(result.scope === "local" ? ["--local"] : [])]),
	}));
}

function createConfigSpawnEnvCommand(deps: ConfigDeps, recordDeps: ConfigRecordDeps): Command {
	return new Command("spawn-env")
		.description("Inspect or author the fail-closed environment used for spawned operations")
		.option("--local", "Use project-local .refarm/config.json")
		.option("--json", "Output machine-readable spawn environment")
		.addHelpText("after", `\nExamples:\n  $ refarm config spawn-env\n  $ refarm config spawn-env set /home/me/.local/bin /usr/bin /bin --home /home/me\n  $ refarm config spawn-env unset\n\nNotes:\n  PATH order is authority: entries are persisted exactly in the declared order.\n  The runtime never falls back to the daemon's ambient PATH or HOME.\n`)
		.action((opts: { local?: boolean } & JsonOptionCarrier, command: JsonOptionCarrier) => {
			const result = readSpawnEnv(opts, deps);
			if (hasJsonOption(opts, command)) printSpawnEnvJson("spawn-env.get", result);
			else printSpawnEnv(result);
		})
		.addCommand(new Command("set")
			.description("Declare the ordered executable search path and optional HOME")
			.argument("<directories...>", "Absolute PATH entries in search order")
			.option("--home <path>", "Absolute HOME injected into spawned operations")
			.option("--local", "Write project-local .refarm/config.json")
			.option("--why <reason>", "Record why you are making this change")
			.option("--json", "Output machine-readable result")
			.action(guardedAction((...args) => ({ json: configActionJson(...args), ...configRefusalHandoff("spawn-env.set") }), async (directories: string[], opts: ConfigMutationOptions & { home?: string } & JsonOptionCarrier, command: JsonOptionCarrier) => {
				// Commander files `--local` on the nearest ancestor declaring it — `spawn-env`,
				// not `set` — so reading it off our own opts() writes the HOME scope while the
				// operator asked for the repo one. Same walk `config history undo` already does.
				const result = await setSpawnEnv(directories, { ...opts, local: hasLocalOption(opts, command) }, deps, recordDeps);
				if (hasJsonOption(opts, command)) printSpawnEnvJson("spawn-env.set", result);
				else printSpawnEnv(result);
			})))
		.addCommand(new Command("unset")
			.description("Remove the declared spawn environment")
			.option("--local", "Update project-local .refarm/config.json")
			.option("--why <reason>", "Record why you are making this change")
			.option("--json", "Output machine-readable result")
			.action(guardedAction((...args) => ({ json: configActionJson(...args), ...configRefusalHandoff("spawn-env.unset") }), async (opts: ConfigMutationOptions & JsonOptionCarrier, command: JsonOptionCarrier) => {
				const result = await unsetSpawnEnv({ ...opts, local: hasLocalOption(opts, command) }, deps, recordDeps);
				if (hasJsonOption(opts, command)) printSpawnEnvJson("spawn-env.unset", result);
				else printSpawnEnv(result);
			})));
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
		return (
			resolveCliOpenExternalLinksMode({
				cwd: deps.cwd(),
				home: deps.home(),
				env: {},
			}) ?? { value: "auto", source: "default" }
		);
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
	return resolveRuntimeSidecarUrl({ cwd: deps.cwd(), home: deps.home(), env: process.env }, opts);
}

/**
 * The refusal helpers THROW rather than print.
 *
 * They used to write two red lines to stderr, set `process.exitCode = 1` and return `null`,
 * which the action read as "stop". That silently ignored `--json`: the consumer got exit 1,
 * a plain sentence on stderr and NOTHING on stdout — no envelope, no handoff. Since they
 * are called from three levels down (`applyKeyToConfig` → `persistConfigValue` → the
 * action), threading the output mode through them would thread a display concern through
 * the whole write path. Throwing keeps them pure signals and lets the ACTION BOUNDARY —
 * the one place that knows whether `--json` was asked for — decide how a refusal is shown.
 */
function parseConfigKey(value: string): ConfigKey {
	if ((CONFIG_KEYS as readonly string[]).includes(value)) return value as ConfigKey;
	throw new CommandRefusal(
		"unknown-config-key",
		`Unknown config key: ${value}`,
		`Use: ${CONFIG_KEYS.join(", ")}`,
	);
}

function parseConfigAutostartMode(
	key: Extract<ConfigKey, "runtime.autostart">,
	value: string,
): AutostartMode {
	const mode = parseAutostartMode(value);
	if (mode) return mode;
	throw new CommandRefusal(
		"invalid-config-value",
		`Invalid ${key}: ${value}`,
		`Use: ${AUTOSTART_MODES.join(", ")}`,
	);
}

function parseConfigOpenExternalLinksMode(value: string): OpenExternalLinksMode {
	if ((OPEN_EXTERNAL_LINKS_MODES as readonly string[]).includes(value)) {
		return value as OpenExternalLinksMode;
	}
	throw new CommandRefusal(
		"invalid-config-value",
		`Invalid operator.openExternalLinks: ${value}`,
		`Use: ${OPEN_EXTERNAL_LINKS_MODES.join(", ")}`,
	);
}

function parseConfigTractorEngineMode(value: string): TractorEngineMode {
	const mode = parseTractorEngineMode(value);
	if (mode) return mode;
	throw new CommandRefusal(
		"invalid-config-value",
		`Invalid tractor.engine: ${value}`,
		`Use: ${TRACTOR_ENGINE_MODES.join(", ")}`,
	);
}

function parseConfigSidecarUrl(value: string): string {
	const sidecarUrl = parseRuntimeSidecarUrl(value);
	if (sidecarUrl) return sidecarUrl;
	throw new CommandRefusal(
		"invalid-config-value",
		`Invalid runtime.sidecarUrl: ${value}`,
		"Use an http:// or https:// URL, for example http://127.0.0.1:42001",
	);
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
	if (key === "runtime.autostart") {
		const effective = resolveAutostartMode(deps, opts);
		return {
			key,
			value: effective.value,
			source: effective.source,
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
	console.log(
		chalk.dim("  Future: running this command without arguments can become interactive."),
	);
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

function configScope(opts: { local?: boolean }): "home" | "local" {
	return opts.local ? "local" : "home";
}

function printPersistedConfigValue(result: PersistedConfigValue): void {
	console.log(chalk.green(`✓  ${result.key}=${result.value}`));
	console.log(chalk.dim(`   ${result.path}`));
	// The record is only sovereignty if the operator can find it. Printing the undo command is
	// the difference between a trail and a log nobody knows how to act on (R3).
	console.log(
		chalk.dim(
			`   recorded — undo with \`refarm config history undo ${result.recordId}${
				result.scope === "local" ? " --local" : ""
			}\``,
		),
	);
}

function printPersistedConfigValueJson(result: PersistedConfigValue): void {
	const nextCommand = configGetCommand(result.key, { local: result.scope === "local" });
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "set",
			extra: result,
			nextCommand,
			nextCommands: [nextCommand, configHistoryCommand({ local: result.scope === "local" })],
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
	if (result.recordId) {
		console.log(
			chalk.dim(
				`   recorded — undo with \`refarm config history undo ${result.recordId}${
					result.scope === "local" ? " --local" : ""
				}\``,
			),
		);
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
			nextCommands: result.recordId
				? [nextCommand, configHistoryCommand({ local: result.scope === "local" })]
				: [nextCommand],
		}),
	);
}

function configHistoryCommand(opts: { local?: boolean }): string {
	return refarmCommand(["config", "history", "--json", ...(opts.local ? ["--local"] : [])]);
}

/**
 * `refarm config history` — the record made readable.
 *
 * R3 is explicit that a record nobody can read is a log, and that a log does not give the operator
 * sovereignty over what was done. This is the view that closes that gap: what changed, when, who,
 * why, and the exact command that puts it back.
 *
 * It reads the WHOLE trail for the scope, not only `config-*` records — for the home scope that
 * file is `~/.refarm/operations.json`, which the cold-bootstrap kit also writes its PATH decision
 * into. Filtering the kit's entry out would hide half of what has been configured on this machine
 * from the one command whose job is showing it.
 */
function printConfigHistory(entries: ConfigHistoryEntry[], trailPath: string): void {
	console.log(chalk.bold("Refarm config history"));
	console.log(chalk.dim(`  ${trailPath}`));
	if (entries.length === 0) {
		console.log(chalk.dim("  (nothing recorded yet)"));
		return;
	}
	for (const entry of entries) {
		console.log("");
		console.log(`  ${entry.decidedAt}  ${entry.decision}  ${entry.title}`);
		console.log(chalk.dim(`    why:   ${entry.purpose}`));
		console.log(chalk.dim(`    who:   ${entry.decidedBy} (asked by ${entry.requester})`));
		for (const filePath of entry.paths) console.log(chalk.dim(`    file:  ${filePath}`));
		console.log(chalk.dim(`    undo:  ${entry.undo}`));
		console.log(
			chalk.dim(
				`    ${entry.undoCommand ? `run:   ${entry.undoCommand}` : "run:   (not reversible)"}`,
			),
		);
	}
}

function printConfigHistoryJson(entries: ConfigHistoryEntry[], trailPath: string): void {
	const nextCommand = entries[0]?.undoCommand ?? null;
	printJson(
		buildJsonSuccessEnvelope({
			command: "config",
			operation: "history",
			extra: { trail: trailPath, entries },
			...(nextCommand ? { nextCommand, nextCommands: [nextCommand] } : {}),
		}),
	);
}

function configGetCommand(key: ConfigKey, opts: { local?: boolean }): string {
	return refarmCommand(["config", "get", key, "--json", ...(opts.local ? ["--local"] : [])]);
}

function applyConfigProfile(
	profile: string,
	opts: { local?: boolean },
	deps: ConfigDeps,
): AppliedConfigProfile {
	if (profile !== "coding") {
		throw new CommandRefusal(
			"unknown-config-profile",
			`Unknown config profile: ${profile}`,
			"Use: coding",
		);
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

/** Apply `key = value` to an in-memory config object, returning the value actually persisted.
 *  Throws a `CommandRefusal` when the value is invalid — the parsers are the validators and the
 *  action boundary renders what they raise. PURE over `config`, which it mutates in place — the
 *  caller owns the object and decides whether it is ever written. */
function applyKeyToConfig(config: RefarmCliConfig, key: ConfigKey, value: string): string {
	if (key === "runtime.autostart") {
		const mode = parseConfigAutostartMode(key, value);
		config.autostart = mode;
		return mode;
	}
	if (key === "operator.openExternalLinks") {
		const mode = parseConfigOpenExternalLinksMode(value);
		config.operator = { ...(config.operator ?? {}), openExternalLinks: mode };
		return mode;
	}
	if (key === "runtime.sidecarUrl") {
		const sidecarUrl = parseConfigSidecarUrl(value);
		config.runtime = { ...(config.runtime ?? {}), sidecarUrl };
		return sidecarUrl;
	}
	const mode = parseConfigTractorEngineMode(value);
	config.tractor = { ...(config.tractor ?? {}), engine: mode };
	return mode;
}

/** Remove `key` from an in-memory config object. `true` when it was actually there. */
function removeKeyFromConfig(config: RefarmCliConfig, key: ConfigKey): boolean {
	if (key === "runtime.autostart") {
		const removed = Object.prototype.hasOwnProperty.call(config, "autostart");
		if (removed) delete config.autostart;
		return removed;
	}
	if (key === "operator.openExternalLinks") {
		const removed = Object.prototype.hasOwnProperty.call(
			config.operator ?? {},
			"openExternalLinks",
		);
		if (removed && config.operator) delete config.operator.openExternalLinks;
		return removed;
	}
	if (key === "runtime.sidecarUrl") {
		const removed = Object.prototype.hasOwnProperty.call(config.runtime ?? {}, "sidecarUrl");
		if (removed && config.runtime) delete config.runtime.sidecarUrl;
		return removed;
	}
	if (key === "tractor.engine") {
		const removed = Object.prototype.hasOwnProperty.call(config.tractor ?? {}, "engine");
		if (removed && config.tractor) delete config.tractor.engine;
		return removed;
	}
	return false;
}

/**
 * Persist `key = value` AND remember it.
 *
 * The write itself is performed by `recordConfigMutation`, not by `writeConfig`: the mutation and
 * its record are one operation, so a trail that cannot be appended rolls the file back rather than
 * leaving a change nobody can see, judge, or undo. No prompt is involved — see `config-record.ts`
 * for why confirming what the operator just typed is the behaviour R4 exists to prevent.
 */
async function persistConfigValue(
	key: ConfigKey,
	value: string,
	opts: ConfigMutationOptions,
	deps: ConfigDeps,
	recordDeps: ConfigRecordDeps = {},
): Promise<PersistedConfigValue> {
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	// Throws before anything is written when the value is invalid: a refusal must leave the
	// file exactly as it found it.
	const persisted = applyKeyToConfig(config, key, value);

	const scope = configScope(opts);
	const record = await recordConfigMutation(
		{
			kind: CONFIG_SET_KIND,
			key,
			value: persisted,
			scope,
			filePath,
			// Read as BYTES, so the undo restores what was actually on disk rather than a
			// re-serialisation of what we managed to parse out of it.
			before: readConfigSnapshot(filePath),
			after: serializeConfig(config),
			why: opts.why,
			requestedAt: (recordDeps.now ?? (() => new Date().toISOString()))(),
		},
		recordDeps,
	);

	return { key, value: persisted, path: filePath, scope, recordId: record.id };
}

async function unsetConfigValue(
	key: ConfigKey,
	opts: ConfigMutationOptions,
	deps: ConfigDeps,
	recordDeps: ConfigRecordDeps = {},
): Promise<UnsetConfigValue> {
	const filePath = configPath(deps, opts);
	const config = readConfig(filePath);
	const before = readConfigSnapshot(filePath);
	const removed = removeKeyFromConfig(config, key);
	const scope = configScope(opts);

	// Nothing was there ⇒ nothing changed ⇒ nothing to remember. Recording a no-op would fill the
	// trail with entries whose undo restores a file to itself, which is noise dressed as memory.
	if (!removed) {
		return { key, path: filePath, scope, removed, recordId: null };
	}

	const record = await recordConfigMutation(
		{
			kind: CONFIG_UNSET_KIND,
			key,
			scope,
			filePath,
			before,
			after: serializeConfig(config),
			why: opts.why,
			requestedAt: (recordDeps.now ?? (() => new Date().toISOString()))(),
		},
		recordDeps,
	);

	return { key, path: filePath, scope, removed, recordId: record.id };
}

export function createConfigCommand(
	deps: ConfigDeps = defaultDeps(),
	/** Seams for the operation RECORD — clock, operator identity, filesystem, trail. Injected by
	 *  tests so a config change can be recorded without a real HOME and without a real clock. */
	recordDeps: ConfigRecordDeps = {},
): Command {
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
  $ refarm config history
  $ refarm config history undo <id>
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

Notes:
  ${RUNTIME_AUTOSTART_ENV_VAR} can be ${AUTOSTART_MODES_HELP} for one-shot autostart policy.
  ${RUNTIME_SIDECAR_URL_ENV_VAR} can point one command at a different runtime sidecar.
  ${OPEN_EXTERNAL_LINKS_ENV_VAR} can be ${OPEN_EXTERNAL_LINKS_MODES_HELP} for one-shot link policy.
  ${TRACTOR_ENGINE_ENV_VAR} can be ${TRACTOR_ENGINE_ENV_HELP} for one-shot runtime selection.
  Without a subcommand, config prints the effective values and their sources.
  The no-argument form is reserved for the future interactive configuration surface.
  Every set/unset is RECORDED with the undo that reverses it — see \`refarm config history\`.
  You are never asked to confirm: the command is the authorisation, the record is the memory.
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
					guardedAction(
						(...args) => ({
							json: configActionJson(...args),
							...configRefusalHandoff("profile"),
						}),
						(
							profile: string,
							opts: { local?: boolean } & JsonOptionCarrier,
							command: JsonOptionCarrier,
						) => {
							const result = applyConfigProfile(profile, opts, deps);
							if (hasJsonOption(opts, command)) {
								printAppliedConfigProfileJson(result);
								return;
							}
							printAppliedConfigProfile(result);
						},
					),
				),
		)
		.addCommand(createConfigPluginsCommand(deps))
		.addCommand(createConfigSpawnEnvCommand(deps, recordDeps))
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

Notes:
  Without --local, project-local config overrides home config. Environment
  overrides such as ${RUNTIME_AUTOSTART_ENV_VAR}, ${OPEN_EXTERNAL_LINKS_ENV_VAR}, and ${TRACTOR_ENGINE_ENV_VAR} still
  take precedence and are shown in the source line.
`,
				)
				.action(
					guardedAction(
						(...args) => ({
							json: configActionJson(...args),
							...configRefusalHandoff("get"),
						}),
						(
							key: string,
							opts: { local?: boolean } & JsonOptionCarrier,
							command: JsonOptionCarrier,
						) => {
							const parsedKey = parseConfigKey(key);
							if (hasJsonOption(opts, command)) {
								printConfigValueJson(parsedKey, opts, deps);
								return;
							}
							printConfigValue(parsedKey, opts, deps);
						},
					),
				),
		)
		.addCommand(
			new Command("unset")
				.description("Remove a persisted config value so defaults or environment can apply")
				.argument("<key>", "Config key")
				.option("--local", "Update project-local .refarm/config.json")
				// NOT a confirmation, and deliberately optional. R3 wants "why" in the record and the
				// only honest source of it is the person making the change; a default sentence stating
				// WHAT was asked for is the fallback, never an invented motive.
				.option("--why <reason>", "Record why you are making this change")
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

Notes:
  Unset only changes persisted config. Environment overrides such as
  ${RUNTIME_AUTOSTART_ENV_VAR} still take precedence until removed from the shell.
  Removing a value that was set is RECORDED, with the previous file as the undo.
  Removing one that was never set changes nothing and records nothing.
  Use --why to say why; \`refarm config history\` reads it back.
`,
				)
				.action(
					guardedAction(
						(...args) => ({
							json: configActionJson(...args),
							...configRefusalHandoff("unset"),
						}),
						async (
							key: string,
							opts: ConfigMutationOptions & JsonOptionCarrier,
							command: JsonOptionCarrier,
						) => {
							const parsedKey = parseConfigKey(key);
							const result = await unsetConfigValue(parsedKey, opts, deps, recordDeps);
							if (hasJsonOption(opts, command)) {
								printUnsetConfigValueJson(result);
								return;
							}
							printUnsetConfigValue(result);
						},
					),
				),
		)
		.addCommand(
			new Command("set")
				.description("Persist a config value")
				.argument("<key>", "Config key")
				.argument("<value>", "Config value")
				.option("--local", "Write project-local .refarm/config.json")
				.option("--why <reason>", "Record why you are making this change")
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

Notes:
  Use --local for repository-specific operator preferences. Home config is the
  default and applies across Refarm workspaces for the current user.
  The change is RECORDED with a full before/after snapshot, so \`refarm config history
  undo <id>\` restores the file exactly. Use --why to record why you made it.
  For one-shot overrides, use ${RUNTIME_AUTOSTART_ENV_VAR}, ${OPEN_EXTERNAL_LINKS_ENV_VAR},
  or ${TRACTOR_ENGINE_ENV_VAR} without changing persisted config.
`,
				)
				.action(
					guardedAction(
						(...args) => ({
							json: configActionJson(...args),
							...configRefusalHandoff("set"),
						}),
						async (
							key: string,
							value: string,
							opts: ConfigMutationOptions & JsonOptionCarrier,
							command: JsonOptionCarrier,
						) => {
							const parsedKey = parseConfigKey(key);
							const result = await persistConfigValue(parsedKey, value, opts, deps, recordDeps);
							if (hasJsonOption(opts, command)) {
								printPersistedConfigValueJson(result);
								return;
							}
							printPersistedConfigValue(result);
						},
					),
				),
		)
		.addCommand(createConfigHistoryCommand(deps, recordDeps));
}

/**
 * `refarm config history` (+ `history undo <id>`) — reading and reversing what was recorded.
 *
 * The undo is a SUBCOMMAND of history rather than a flag on it, and rather than a top-level
 * `config undo`, because the id it takes comes from the listing: the two commands are one
 * workflow, and nesting says so. `config plugins list` already establishes the three-level shape.
 */
function createConfigHistoryCommand(deps: ConfigDeps, recordDeps: ConfigRecordDeps): Command {
	return new Command("history")
		.description("Show config changes: what changed, when, why, and how to undo each one")
		.option("--local", "Read the project-local trail (.refarm/operations.json in this directory)")
		.option("--limit <n>", "Show at most this many entries (newest first)", "20")
		.option("--json", "Output the machine-readable trail")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm config history
  $ refarm config history --json
  $ refarm config history --local
  $ refarm config history undo config:home:runtime.autostart#2026-07-30T12:00:00.000Z

Notes:
  Every \`config set\`/\`unset\` is recorded with full before/after snapshots of the config
  file, so the undo restores exactly what was there — it is executed, not described.
  The home-scope trail is ~/.refarm/operations.json, the same file the cold-bootstrap kit
  records its own operations in; --local reads ./.refarm/operations.json instead.
  \`config set\` never asks for confirmation: the command IS the authorisation. What it
  owes you is the memory of it, which is this.
`,
		)
		.action(
			async (
				opts: { local?: boolean; limit?: string } & JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				const filePath = configPath(deps, opts);
				const records = await readConfigTrail(filePath, recordDeps);
				const limit = Number.parseInt(opts.limit ?? "20", 10);
				const entries = buildConfigHistory(records, {
					local: opts.local === true,
					...(Number.isNaN(limit) ? {} : { limit }),
				});
				const trailPath = configTrailPath(filePath);
				if (hasJsonOption(opts, command)) {
					printConfigHistoryJson(entries, trailPath);
					return;
				}
				printConfigHistory(entries, trailPath);
			},
		)
		.addCommand(
			new Command("undo")
				.description("Reverse a recorded config change, restoring the file exactly")
				.argument("<id>", "Record id, as shown by `refarm config history`")
				.option("--local", "Undo from the project-local trail")
				.option("--json", "Output the machine-readable reversal record")
				.action(
					guardedAction(
						(...args) => ({
							json: configActionJson(...args),
							// The ids come from the listing, so the listing is where an unknown id sends you.
							...configRefusalHandoff("history-undo", CONFIG_HISTORY_JSON_COMMAND),
						}),
						async (
							id: string,
							opts: { local?: boolean } & JsonOptionCarrier,
							command: JsonOptionCarrier,
						) => {
							// `--local` up the whole chain: `history` declares the same flag and, having
							// an action of its own, parses the argv first and swallows it. See
							// `hasLocalOption` — the scope of an undo decides which file is rewritten.
							const filePath = configPath(deps, { local: hasLocalOption(opts, command) });
							const record = await undoConfigOperation(filePath, id, recordDeps);
							if (hasJsonOption(opts, command)) {
								printJson(
									buildJsonSuccessEnvelope({
										command: "config",
										operation: "history-undo",
										extra: {
											id: record.id,
											undoneRecordId: record.revisitOf ?? null,
											paths: record.changes.map((change) => change.path),
											decidedAt: record.decidedAt,
										},
										nextCommand: CONFIG_JSON_COMMAND,
										nextCommands: [CONFIG_JSON_COMMAND],
									}),
								);
								return;
							}
							console.log(chalk.green(`✓  undone: ${record.title}`));
							for (const change of record.changes) {
								console.log(chalk.dim(`   ${change.path} restored`));
							}
							console.log(
								chalk.dim("   the reversal is itself recorded — the trail stays append-only"),
							);
						},
					),
				),
		);
}

export const configCommand = createConfigCommand();
