import { runLaunchProcess } from "@refarm.dev/cli/launch-process";
import {
	isRuntimeAgentPluginId,
	RUNTIME_AGENT_NPM_PACKAGE,
	RUNTIME_AGENT_PLUGIN_ID,
} from "@refarm.dev/config";
import { Command } from "commander";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path, { basename, extname } from "node:path";
import {
	quoteCommandArg,
	refarmCommand,
	shellCommand,
} from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
import {
	createPackageBinaryCommand,
	createPackageScriptCommand,
	PACKAGE_MANAGER_OVERRIDE,
	PACKAGE_MANAGERS,
} from "./package-manager.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
	RUNTIME_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	readRuntimePluginState,
	reloadRuntimePluginsAndWait,
} from "./runtime-plugins.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

// Plugins bundled with the refarm npm package — auto-installed and updated by farmhand on boot.
// To add a new bundled plugin: add an entry here and add it as a dep in farmhand/package.json.
const BUNDLED_PLUGINS = [
	{
		id: RUNTIME_AGENT_PLUGIN_ID,
		npmPackage: RUNTIME_AGENT_NPM_PACKAGE,
		workspaceDir: "packages/pi-agent",
		wasmFile: "dist/pi_agent.wasm",
		manifestFile: "dist/plugin.json",
		requiredProvides: ["agent:respond"],
	},
] as const;

type BundledPlugin = (typeof BUNDLED_PLUGINS)[number];
const PACKAGE_MANAGER_OVERRIDE_HELP = PACKAGE_MANAGERS.join("|");
const PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND = RUNTIME_AGENT_RELOAD_JSON_COMMAND;

function pluginBundleCommand(
	input: string,
	options: {
		output: string;
		name: string;
		dryRun?: boolean;
		json?: boolean;
	},
): string {
	return refarmCommand([
		"plugin",
		"bundle",
		quoteCommandArg(input),
		"-o",
		quoteCommandArg(options.output),
		"--name",
		quoteCommandArg(options.name),
		...(options.dryRun ? ["--dry-run"] : []),
		...(options.json ? ["--json"] : []),
	]);
}

const pluginsBaseDir = path.join(os.homedir(), ".refarm", "plugins");

interface PluginListEntry {
	id: string;
	version: string | null;
	source: "bundled";
	installed: boolean;
}

interface PluginListReport {
	plugins: PluginListEntry[];
	ok?: true;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

interface RuntimePluginStatusEntry {
	id: string;
	installed: boolean;
	loaded: boolean;
	local: boolean;
}

interface RuntimePluginStatusReport {
	command: "plugin";
	operation: "status";
	ok: boolean;
	available: boolean;
	plugins: RuntimePluginStatusEntry[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	recommendations?: RuntimePluginRecommendation[];
	recovery?: {
		ensure: string;
		start: string;
		status: string;
		doctorNextAction: string;
		doctor: string;
	};
}

interface RuntimePluginRecommendation {
	diagnostic: string;
	severity: "failure" | "warning" | "info";
	summary: string;
	action: string;
	command?: string;
}

type PluginInstallStatus = "installed" | "cached" | "failed";

interface PluginInstallResult {
	id: string;
	packageName: string;
	status: PluginInstallStatus;
	version: string | null;
	message?: string;
	buildCommand?: string;
	bytes?: number;
	integrity?: string;
}

interface PluginInstallReport {
	failed: number;
	plugins: PluginInstallResult[];
	ok?: boolean;
	error?: string;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
}

function localRuntimeAgentBuildCommand(): string {
	return createPackageScriptCommand({
		cwd: "packages/pi-agent",
		script: "build",
	}).display;
}

function resolvePackageDirFromNodeModules(packageName: string): string | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJsonPath = require.resolve(`${packageName}/package.json`);
		return path.dirname(pkgJsonPath);
	} catch {
		return null;
	}
}

function resolveWorkspacePackageDir(plugin: BundledPlugin): string | null {
	if (!("workspaceDir" in plugin)) return null;
	let current = process.cwd();
	while (true) {
		const pkgDir = path.join(current, plugin.workspaceDir);
		const pkgJsonPath = path.join(pkgDir, "package.json");
		if (existsSync(pkgJsonPath)) {
			try {
				const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: string };
				if (pkgJson.name === plugin.npmPackage) return pkgDir;
			} catch {
				return null;
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function resolvePackageDir(plugin: BundledPlugin): string | null {
	return resolvePackageDirFromNodeModules(plugin.npmPackage) ?? resolveWorkspacePackageDir(plugin);
}

function readPackageVersion(pkgDir: string): string | null {
	try {
		const pkgJson = JSON.parse(
			readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
		) as { version?: string };
		return pkgJson.version ?? null;
	} catch {
		return null;
	}
}

function sentinelPath(pluginId: string): string {
	return path.join(
		pluginsBaseDir,
		".versions",
		pluginId.replace(/\//g, "_").replace(/@/g, ""),
	);
}

async function readInstalledVersion(pluginId: string): Promise<string | null> {
	try {
		return (await readFile(sentinelPath(pluginId), "utf-8")).trim();
	} catch {
		return null;
	}
}

async function installedBundleIsCurrent(
	plugin: BundledPlugin,
	version: string,
	integrity: string,
): Promise<boolean> {
	const installed = await readInstalledVersion(plugin.id);
	if (installed !== version) return false;

	try {
		const manifestPath = path.join(pluginsBaseDir, plugin.id, "plugin.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
			integrity?: unknown;
			capabilities?: { provides?: unknown };
		};
		if (manifest.integrity !== integrity) return false;
		const requiredProvides = "requiredProvides" in plugin ? plugin.requiredProvides : [];
		if (requiredProvides.length === 0) return true;
		const provides = Array.isArray(manifest.capabilities?.provides)
			? manifest.capabilities.provides
			: [];
		return requiredProvides.every((capability) => provides.includes(capability));
	} catch {
		return false;
	}
}

async function installPlugin(
	plugin: BundledPlugin,
	force: boolean,
	options: { quiet?: boolean } = {},
): Promise<PluginInstallResult> {
	const quiet = options.quiet === true;
	const pkgDir = resolvePackageDir(plugin);
	if (!pkgDir) {
		const message = `package ${plugin.npmPackage} not found in node_modules`;
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: null,
			message,
		};
	}

	const pkgVersion = readPackageVersion(pkgDir);
	if (!pkgVersion) {
		const message = "cannot read package version";
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: null,
			message,
		};
	}

	const wasmSrc = path.join(pkgDir, plugin.wasmFile);
	if (!existsSync(wasmSrc)) {
		const buildCommand = localRuntimeAgentBuildCommand();
		const message = `WASM not found at ${wasmSrc}`;
		if (!quiet) {
			console.error(`  ✗ ${plugin.id}: ${message}`);
			console.error(`    Build first: ${buildCommand}`);
		}
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: pkgVersion,
			message,
			buildCommand,
		};
	}

	try {
		const wasmBytes = readFileSync(wasmSrc);
		const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
		const integrity = `sha256-${sha256}`;

		if (!force && await installedBundleIsCurrent(plugin, pkgVersion, integrity)) {
			const message = "already up-to-date";
			if (!quiet) console.log(`  ✓ ${plugin.id} v${pkgVersion} ${message}`);
			return {
				id: plugin.id,
				packageName: plugin.npmPackage,
				status: "cached",
				version: pkgVersion,
				message,
			};
		}

		const destDir = path.join(pluginsBaseDir, plugin.id);
		await mkdir(destDir, { recursive: true });

		copyFileSync(wasmSrc, path.join(destDir, "plugin.wasm"));

		const template = JSON.parse(
			readFileSync(path.join(pkgDir, plugin.manifestFile), "utf-8"),
		) as Record<string, unknown>;
		const manifest = {
			...template,
			entry: `file://${path.join(destDir, "plugin.wasm")}`,
			integrity,
		};
		await writeFile(
			path.join(destDir, "plugin.json"),
			JSON.stringify(manifest, null, 2) + "\n",
			"utf-8",
		);

		const sentinel = sentinelPath(plugin.id);
		await mkdir(path.dirname(sentinel), { recursive: true });
		await writeFile(sentinel, pkgVersion, "utf-8");

		if (!quiet) {
			console.log(`  ✓ ${plugin.id} v${pkgVersion} installed (${wasmBytes.byteLength} bytes)`);
		}
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "installed",
			version: pkgVersion,
			bytes: wasmBytes.byteLength,
			integrity,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: pkgVersion,
			message,
		};
	}
}

async function installBundledPlugins(options: {
	force?: boolean;
	json?: boolean;
	heading?: string;
}): Promise<void> {
	if (!options.json && options.heading) {
		console.log(options.heading);
	}

	const results: PluginInstallResult[] = [];
	for (const plugin of BUNDLED_PLUGINS) {
		results.push(
			await installPlugin(plugin, options.force === true, {
				quiet: options.json === true,
			}),
		);
	}

	const failed = results.filter((result) => result.status === "failed").length;
	if (options.json) {
		const failedResult = results.find((result) => result.status === "failed");
		const report: PluginInstallReport = failedResult
			? buildJsonErrorEnvelope({
					command: "plugin",
					operation: "install",
					error: "plugin-install-failed",
					message: failedResult.message,
					nextAction: failedResult.buildCommand ?? PLUGIN_INSTALL_COMMAND,
					nextCommand: failedResult.buildCommand ?? PLUGIN_INSTALL_JSON_COMMAND,
					nextCommands: [
						...(failedResult.buildCommand ? [failedResult.buildCommand] : []),
						PLUGIN_INSTALL_JSON_COMMAND,
						PLUGIN_STATUS_JSON_COMMAND,
					],
					extra: { failed, plugins: results },
				})
			: buildJsonSuccessEnvelope({
					command: "plugin",
					operation: "install",
					nextCommand: PLUGIN_STATUS_JSON_COMMAND,
					nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
					extra: { failed, plugins: results },
				});
		printJson(report);
	}
	if (failed > 0) process.exitCode = 1;
}

async function buildPluginListReport(): Promise<PluginListReport> {
	const plugins: PluginListEntry[] = [];

	for (const plugin of BUNDLED_PLUGINS) {
		const version = await readInstalledVersion(plugin.id);
		plugins.push({
			id: plugin.id,
			version,
			source: "bundled",
			installed: version !== null,
		});
	}

	return { plugins };
}

async function listInstalledPlugins(options: { json?: boolean } = {}): Promise<void> {
	const report = await buildPluginListReport();

	if (options.json) {
		const missing = report.plugins.some((plugin) => !plugin.installed);
		printJson(
			buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "list",
				nextCommand: missing ? PLUGIN_INSTALL_JSON_COMMAND : PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: missing
					? [PLUGIN_INSTALL_JSON_COMMAND, PLUGIN_STATUS_JSON_COMMAND]
					: [PLUGIN_STATUS_JSON_COMMAND],
				extra: report,
			}),
		);
		return;
	}

	const results = report.plugins;
	if (results.length === 0) {
		console.log("No plugins installed. Run 'refarm plugin install' to install bundled plugins.");
		return;
	}

	const idWidth = Math.max(...results.map((r) => r.id.length), 4);
	const verWidth = Math.max(...results.map((r) => (r.version ?? "not installed").length), 7);

	console.log(
		`  ${"PLUGIN".padEnd(idWidth)}  ${"VERSION".padEnd(verWidth)}  SOURCE`,
	);
	for (const { id, version, source } of results) {
		const ver = version ?? "not installed";
		console.log(`  ${id.padEnd(idWidth)}  ${ver.padEnd(verWidth)}  ${source}`);
	}
}

function buildRuntimePluginStatusReport(
	state: Awaited<ReturnType<typeof readRuntimePluginState>>,
): RuntimePluginStatusReport {
	if (!state) {
		const recommendations = runtimePluginUnavailableRecommendations();
		return {
			command: "plugin",
			operation: "status",
			ok: false,
			available: false,
			plugins: [],
			nextAction: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextActions: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextCommands: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			recommendations,
			recovery: {
				ensure: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				start: RUNTIME_START_WAIT_COMMAND,
				status: RUNTIME_STATUS_COMMAND,
				doctorNextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				doctor: RUNTIME_DOCTOR_COMMAND,
			},
		};
	}

	const known =
		state.known.length > 0 ? state.known : BUNDLED_PLUGINS.map((p) => p.id);
	const runtimeAgentInstalled = state.installed.some(isRuntimeAgentPluginId);
	const runtimeAgentLoaded =
		typeof state.activeAgent === "string" && state.activeAgent.length > 0;
	const nextCommands = runtimeAgentLoaded
		? []
		: [
				...(runtimeAgentInstalled
					? [PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND]
					: [PLUGIN_INSTALL_JSON_COMMAND]),
				PLUGIN_STATUS_JSON_COMMAND,
			];
	const nextAction = runtimeAgentLoaded
		? null
		: runtimeAgentInstalled
			? PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND
			: PLUGIN_INSTALL_COMMAND;
	return {
		command: "plugin",
		operation: "status",
		ok: runtimeAgentLoaded,
		available: true,
		plugins: known.map((id) => ({
			id,
			installed: state.installed.includes(id),
			loaded: state.loaded.includes(id),
			local: state.local.includes(id),
		})),
		nextAction,
		nextActions: nextCommands,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function runtimePluginUnavailableRecommendations(): RuntimePluginRecommendation[] {
	return [
		{
			diagnostic: "runtime-plugin-status-unavailable",
			severity: "failure",
			summary: "The runtime plugin status endpoint is not reachable.",
			action: "Ensure the selected runtime is running, then inspect plugin status again.",
			command: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
		},
	];
}

async function printRuntimePluginStatus(options: { json?: boolean } = {}): Promise<void> {
	const state = await readRuntimePluginState();
	const report = buildRuntimePluginStatusReport(state);
	if (options.json) {
		printJson(report);
		if (!report.ok) process.exitCode = 1;
		return;
	}

	if (!state) {
		console.error("Refarm runtime plugin status is unavailable.");
		console.error(`Ensure runtime readiness with \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`, then retry.`);
		console.error(`Fallback start command: \`${RUNTIME_START_WAIT_COMMAND}\`.`);
		console.error(`Inspect runtime readiness with \`${RUNTIME_STATUS_COMMAND}\`.`);
		console.error(`Next recovery action: \`${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\`.`);
		console.error(`Diagnose readiness with \`${RUNTIME_DOCTOR_COMMAND}\`.`);
		process.exitCode = 1;
		return;
	}

	const known = report.plugins.map((plugin) => plugin.id);
	const idWidth = Math.max(...known.map((id) => id.length), 6);

	console.log(`  ${"PLUGIN".padEnd(idWidth)}  INSTALLED  LOADED  LOCAL`);
	for (const plugin of report.plugins) {
		const installed = plugin.installed ? "yes" : "no";
		const loaded = plugin.loaded ? "yes" : "no";
		const local = plugin.local ? "yes" : "no";
		console.log(
			`  ${plugin.id.padEnd(idWidth)}  ${installed.padEnd(9)}  ${loaded.padEnd(6)}  ${local}`,
		);
	}

	if (!report.plugins.some((plugin) => plugin.id === RUNTIME_AGENT_PLUGIN_ID && plugin.loaded)) {
		console.log("");
		console.log("Runtime agent plugin is not loaded.");
		console.log(`  Install:  ${PLUGIN_INSTALL_COMMAND}`);
		console.log(`  Reload:   ${PLUGIN_RELOAD_RUNTIME_AGENT_JSON_COMMAND}`);
		console.log("  Ask:      refarm ask hello");
		console.log(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`);
	}
}

async function reloadRuntimePluginCommand(
	pluginIds: string[],
	options: { json?: boolean } = {},
): Promise<void> {
	const requested = pluginIds.length > 0 ? pluginIds : undefined;
	if (!options.json) {
		console.log(
			requested
				? `Reloading runtime plugins: ${requested.join(", ")}`
				: "Reloading runtime plugins...",
		);
	}

	const result = await reloadRuntimePluginsAndWait(requested, {
		onDeferred(pluginId) {
			if (!options.json) {
				console.log(`  waiting for ${pluginId} to become idle...`);
			}
		},
	});

	if (!result) {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "plugin",
					operation: "reload",
					error: "runtime-plugin-reload-unavailable",
					message: "Refarm runtime plugin reload is unavailable.",
					nextAction: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					nextCommands: [
						RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
						RUNTIME_START_WAIT_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
					extra: {
						requested: pluginIds,
						recommendations: runtimePluginUnavailableRecommendations(),
					},
				}),
			);
		} else {
			console.error("Runtime plugin reload is unavailable.");
			console.error(`  Ensure runtime: ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}`);
			console.error(`  Start fallback:  ${RUNTIME_START_WAIT_COMMAND}`);
			console.error(`  Diagnose:      ${RUNTIME_DOCTOR_COMMAND}`);
		}
		process.exitCode = 1;
		return;
	}

	if (options.json) {
		if (result.skipped.length > 0) {
			printJson(
				buildJsonErrorEnvelope({
					command: "plugin",
					operation: "reload",
					error: "runtime-plugin-reload-partial",
					message: "One or more runtime plugins failed to reload.",
					nextAction: PLUGIN_STATUS_JSON_COMMAND,
					nextCommand: PLUGIN_STATUS_JSON_COMMAND,
					nextCommands: [
						PLUGIN_STATUS_JSON_COMMAND,
						RUNTIME_DOCTOR_NEXT_COMMAND,
					],
					extra: {
						requested: pluginIds,
						reloaded: result.reloaded,
						skipped: result.skipped,
					},
				}),
			);
			process.exitCode = 1;
			return;
		}
		printJson(
			buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "reload",
				nextCommand: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
				extra: {
					requested: pluginIds,
					reloaded: result.reloaded,
					skipped: result.skipped,
				},
			}),
		);
		return;
	}

	for (const pluginId of result.reloaded) {
		console.log(`  ✓ ${pluginId} reloaded`);
	}
	for (const pluginId of result.skipped) {
		console.error(`  ✗ ${pluginId} failed to reload`);
	}
	if (result.skipped.length > 0) {
		process.exitCode = 1;
	}
	if (result.reloaded.length === 0 && result.skipped.length === 0) {
		console.log("  No plugins to reload.");
	}
}

export const pluginCommand = new Command("plugin").description(
	"Manage refarm plugins",
).addHelpText(
	"after",
	[
		"",
		"Examples:",
		"  $ refarm plugin status",
		"  $ refarm plugin status --json",
		"  $ refarm plugin reload runtime-agent --json",
		"  $ refarm plugin install",
		"  $ refarm plugin list",
		"  $ refarm plugin list --json",
		"  $ refarm plugin bundle ./plugin.wasm --name my-plugin",
		"  $ refarm",
		"",
	"Notes:",
	"  Install writes bundled plugin artifacts into ~/.refarm/plugins.",
	`  Status reads the active Refarm runtime; ensure it with ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND} if unavailable.`,
	`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
	`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
	"  refarm ask preflights the runtime agent plugin and asks the runtime to reload it when installed but not loaded.",
	"  In refarm chat, /reload runtime-agent is the interactive equivalent.",
	].join("\n"),
);

pluginCommand
	.command("install")
	.description("Install (or force-reinstall) all bundled plugins from their npm packages")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin install",
			"  $ refarm plugin install --json",
			"  $ refarm plugin install --force",
			"",
			"Notes:",
			"  If the bundled runtime agent WASM is missing, build @refarm.dev/pi-agent first with the command printed by the error.",
			"  After install, start or restart the runtime, then run refarm plugin reload runtime-agent --json.",
			"  In refarm chat, /reload runtime-agent is the interactive equivalent.",
			"  Run refarm plugin status to confirm runtime load state.",
		].join("\n"),
	)
	.option("-f, --force", "Reinstall even if already up-to-date", false)
	.option("--json", "Output machine-readable install report")
	.action(async (options: { force: boolean; json?: boolean }) => {
		await installBundledPlugins({
			force: options.force,
			json: options.json,
			heading: "Installing bundled plugins...",
		});
	});

pluginCommand
	.command("update")
	.description("Update bundled plugins when a newer npm package version is available")
	.option("--json", "Output machine-readable update report")
	.action(async (options: { json?: boolean }) => {
		await installBundledPlugins({
			force: false,
			json: options.json,
			heading: "Checking bundled plugins for updates...",
		});
	});

pluginCommand
	.command("list")
	.description("List installed plugins and their versions")
	.option("--json", "Output machine-readable plugin inventory")
	.action(listInstalledPlugins);

pluginCommand
	.command("status")
	.description("Show runtime plugin install/load state")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin status",
			"  $ refarm plugin status --json",
			"  $ refarm plugin reload runtime-agent --json",
			`  $ ${RUNTIME_STATUS_COMMAND}`,
			"  $ refarm",
			"",
			"Notes:",
			"  This command requires the selected Refarm runtime sidecar.",
			`  Use ${RUNTIME_STATUS_COMMAND} to see the selected engine and readiness.`,
			`  Ensure it with ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.`,
			`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
			`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
			"  In refarm chat, /reload runtime-agent is the interactive equivalent.",
		].join("\n"),
	)
	.option("--json", "Output machine-readable runtime plugin state")
	.action(printRuntimePluginStatus);

pluginCommand
	.command("reload [pluginIds...]")
	.description("Ask the running Refarm runtime to hot-reload plugins")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin reload",
			"  $ refarm plugin reload runtime-agent",
			"  $ refarm plugin reload runtime-agent --json",
			"",
			"Notes:",
			"  This is the non-interactive equivalent of /reload in refarm chat.",
			`  Use ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND} if the runtime is not running.`,
		].join("\n"),
	)
	.option("--json", "Output machine-readable reload result")
	.action(reloadRuntimePluginCommand);

pluginCommand
	.command("bundle <input>")
	.description("Transpile a WASM plugin to a JS component using jco transpile")
	.option("-o, --output <dir>", "Output directory", "./dist")
	.option("-n, --name <name>", "Plugin name (defaults to input filename without extension)")
	.option("--dry-run", "Print the plugin bundle plan without executing it")
	.option("--json", "Output machine-readable bundle plan or result")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin bundle ./plugin.wasm",
			"  $ refarm plugin bundle ./plugin.wasm --dry-run --json",
			"  $ refarm plugin bundle ./plugin.wasm --name my-plugin --output ./dist",
			`  $ ${PACKAGE_MANAGER_OVERRIDE}=npm refarm plugin bundle ./plugin.wasm`,
			"",
			"Notes:",
			"  This command runs jco through the detected package manager.",
			"  Refarm maps this to pnpm exec, npm exec --, yarn, or bun x",
			"  based on the project packageManager field or lockfile.",
			"  Override detection with",
			`  ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
		].join("\n"),
	)
	.action(async (input: string, options: { output: string; name?: string; dryRun?: boolean; json?: boolean }) => {
		const name = options.name ?? basename(input, extname(input));
		const command = createPackageBinaryCommand("jco", [
			"transpile",
			input,
			"-o",
			options.output,
			"--name",
			name,
		]);
		const executableCommand = shellCommand(command.command, command.args);
		const bundleRefarmCommand = pluginBundleCommand(input, {
			output: options.output,
			name,
		});
		if (options.dryRun) {
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "plugin",
						operation: "bundle",
						nextCommand: bundleRefarmCommand,
						nextCommands: [bundleRefarmCommand],
						extra: {
							input,
							output: options.output,
							name,
							dryRun: true,
							bundleCommand: executableCommand,
							packageManager: command.packageManager ?? null,
							packageManagerCommand: command.command,
							process: command,
							processCommand: command.command,
							processArgs: command.args,
							display: command.display,
							args: command.args,
						},
					}),
				);
				return;
			}
			console.log(`Bundle dry-run for ${name} from ${input}:`);
			console.log(`  → ${command.display}`);
			return;
		}
		if (!options.json) {
			console.log(`Bundling plugin ${name} from ${input}...`);
		}
		let result:
			| Awaited<ReturnType<typeof runLaunchProcess>>
			| undefined;
		try {
			if (!options.json) {
				console.log(`  → ${command.display}`);
			}
			result = await runLaunchProcess(
				{
					...command,
					display: command.display,
				},
				{
					capture: options.json === true,
				},
			);
			if (result.exitCode !== 0) {
				const detail = result.stderr?.trim() || result.stdout?.trim();
				throw new Error(detail || `jco exited with code ${result.exitCode}`);
			}
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "plugin",
						operation: "bundle",
						extra: {
							input,
							output: options.output,
							name,
							dryRun: false,
							bundleCommand: executableCommand,
							packageManager: command.packageManager ?? null,
							packageManagerCommand: command.command,
							process: command,
							processCommand: command.command,
							processArgs: command.args,
							display: command.display,
							args: command.args,
							stdout: result.stdout,
							stderr: result.stderr,
							artifact: `${options.output}/${name}.js`,
						},
					}),
				);
				return;
			}
			console.log(`  ✓ Plugin bundled to ${options.output}/${name}.js`);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (options.json) {
				printJson(
					buildJsonErrorEnvelope({
						command: "plugin",
						operation: "bundle",
						error: "plugin-bundle-failed",
						message,
						nextAction: `Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}, or install jco for the detected package manager.`,
						nextCommand: bundleRefarmCommand,
						nextCommands: [
							bundleRefarmCommand,
							pluginBundleCommand(input, {
								output: options.output,
								name,
								dryRun: true,
								json: true,
							}),
						],
						extra: {
							input,
							output: options.output,
							name,
							dryRun: false,
							bundleCommand: executableCommand,
							packageManager: command.packageManager ?? null,
							packageManagerCommand: command.command,
							process: command,
							processCommand: command.command,
							processArgs: command.args,
							display: command.display,
							args: command.args,
							exitCode: result?.exitCode ?? 1,
							stdout: result?.stdout,
							stderr: result?.stderr,
						},
					}),
				);
			} else {
				console.error(`  ✗ Bundle failed: ${message}`);
				console.error(`    Command: ${command.display}`);
				console.error(
					`    Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
				);
			}
			process.exitCode = result?.exitCode && result.exitCode !== 0 ? result.exitCode : 1;
		}
	});
