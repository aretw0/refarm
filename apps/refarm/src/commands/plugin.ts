import { PI_AGENT_NPM_PACKAGE, PI_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path, { basename, extname } from "node:path";
import { printJson } from "./json-output.js";
import {
	createPackageBinaryCommand,
	createPackageScriptCommand,
	PACKAGE_MANAGERS,
} from "./package-manager.js";
import { readRuntimePluginState } from "./runtime-plugins.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

// Plugins bundled with the refarm npm package — auto-installed and updated by farmhand on boot.
// To add a new bundled plugin: add an entry here and add it as a dep in farmhand/package.json.
const BUNDLED_PLUGINS = [
	{
		id: PI_AGENT_PLUGIN_ID,
		npmPackage: PI_AGENT_NPM_PACKAGE,
		wasmFile: "dist/pi_agent.wasm",
		manifestFile: "dist/plugin.json",
	},
] as const;

type BundledPlugin = (typeof BUNDLED_PLUGINS)[number];
const PACKAGE_MANAGER_OVERRIDE_HELP = PACKAGE_MANAGERS.join("|");
const PLUGIN_INSTALL_COMMAND = "refarm plugin install";
const PLUGIN_STATUS_JSON_COMMAND = "refarm plugin status --json";

const pluginsBaseDir = path.join(os.homedir(), ".refarm", "plugins");

interface PluginListEntry {
	id: string;
	version: string | null;
	source: "bundled";
	installed: boolean;
}

interface PluginListReport {
	plugins: PluginListEntry[];
}

interface RuntimePluginStatusEntry {
	id: string;
	installed: boolean;
	loaded: boolean;
	local: boolean;
}

interface RuntimePluginStatusReport {
	available: boolean;
	plugins: RuntimePluginStatusEntry[];
	nextAction?: string;
	nextCommand?: string;
	nextCommands?: string[];
	recovery?: {
		start: string;
		status: string;
		doctorNextAction: string;
		doctor: string;
	};
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
}

function localPiAgentBuildCommand(): string {
	return createPackageScriptCommand({
		cwd: "packages/pi-agent",
		script: "build",
	}).display;
}

function resolvePackageDir(packageName: string): string | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJsonPath = require.resolve(`${packageName}/package.json`);
		return path.dirname(pkgJsonPath);
	} catch {
		return null;
	}
}

function readPackageVersion(packageName: string): string | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJson = JSON.parse(
			readFileSync(require.resolve(`${packageName}/package.json`), "utf-8"),
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

async function installPlugin(
	plugin: BundledPlugin,
	force: boolean,
	options: { quiet?: boolean } = {},
): Promise<PluginInstallResult> {
	const quiet = options.quiet === true;
	const pkgVersion = readPackageVersion(plugin.npmPackage);
	if (!pkgVersion) {
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

	if (!force) {
		const installed = await readInstalledVersion(plugin.id);
		if (installed === pkgVersion) {
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
	}

	const pkgDir = resolvePackageDir(plugin.npmPackage);
	if (!pkgDir) {
		const message = "cannot locate package directory";
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: pkgVersion,
			message,
		};
	}

	const wasmSrc = path.join(pkgDir, plugin.wasmFile);
	if (!existsSync(wasmSrc)) {
		const buildCommand = localPiAgentBuildCommand();
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
		const report: PluginInstallReport = { failed, plugins: results };
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
		printJson(report);
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
		return {
			available: false,
			plugins: [],
			nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
			nextCommand: RUNTIME_START_WAIT_COMMAND,
			nextCommands: [RUNTIME_START_WAIT_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND],
			recovery: {
				start: RUNTIME_START_WAIT_COMMAND,
				status: RUNTIME_STATUS_COMMAND,
				doctorNextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				doctor: RUNTIME_DOCTOR_COMMAND,
			},
		};
	}

	const known =
		state.known.length > 0 ? state.known : BUNDLED_PLUGINS.map((p) => p.id);
	return {
		available: true,
		plugins: known.map((id) => ({
			id,
			installed: state.installed.includes(id),
			loaded: state.loaded.includes(id),
			local: state.local.includes(id),
		})),
		...(state.loaded.includes(PI_AGENT_PLUGIN_ID)
			? {}
			: {
					nextAction: PLUGIN_INSTALL_COMMAND,
					nextCommand: PLUGIN_INSTALL_COMMAND,
					nextCommands: [PLUGIN_INSTALL_COMMAND, PLUGIN_STATUS_JSON_COMMAND],
				}),
	};
}

async function printRuntimePluginStatus(options: { json?: boolean } = {}): Promise<void> {
	const state = await readRuntimePluginState();
	const report = buildRuntimePluginStatusReport(state);
	if (options.json) {
		printJson(report);
		if (!report.available) process.exitCode = 1;
		return;
	}

	if (!state) {
		console.error("Refarm runtime plugin status is unavailable.");
		console.error(`Start or restart the runtime with \`${RUNTIME_START_WAIT_COMMAND}\`, then retry.`);
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

	if (!report.plugins.some((plugin) => plugin.id === PI_AGENT_PLUGIN_ID && plugin.loaded)) {
		console.log("");
		console.log("pi-agent is not loaded.");
		console.log(`  Install:  ${PLUGIN_INSTALL_COMMAND}`);
		console.log("  Reload:   refarm");
		console.log("            then run /reload @refarm/pi-agent");
		console.log("  Ask:      refarm ask hello");
		console.log(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`);
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
		"  $ refarm plugin install",
		"  $ refarm plugin list",
		"  $ refarm plugin list --json",
		"  $ refarm",
		"  › /reload @refarm/pi-agent",
		"  $ refarm plugin bundle ./plugin.wasm --name my-plugin",
		"",
	"Notes:",
	"  Install writes bundled plugin artifacts into ~/.refarm/plugins.",
	`  Status reads the active Refarm runtime; start it with ${RUNTIME_START_WAIT_COMMAND} if unavailable.`,
	`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
	`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
	"  refarm ask preflights pi-agent and asks the runtime to reload it when installed but not loaded.",
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
			"  If the bundled WASM is missing, build pi-agent first with the command printed by the error.",
			"  After install, start or restart the runtime, then run /reload @refarm/pi-agent.",
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
			`  $ ${RUNTIME_STATUS_COMMAND}`,
			"  $ refarm",
			"  › /reload @refarm/pi-agent",
			"",
			"Notes:",
			"  This command requires the selected Refarm runtime sidecar.",
			`  Use ${RUNTIME_STATUS_COMMAND} to see the selected engine and readiness.`,
			`  Start or restart it with ${RUNTIME_START_WAIT_COMMAND}.`,
			`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
			`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
		].join("\n"),
	)
	.option("--json", "Output machine-readable runtime plugin state")
	.action(printRuntimePluginStatus);

pluginCommand
	.command("bundle <input>")
	.description("Transpile a WASM plugin to a JS component using jco transpile")
	.option("-o, --output <dir>", "Output directory", "./dist")
	.option("-n, --name <name>", "Plugin name (defaults to input filename without extension)")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin bundle ./plugin.wasm",
			"  $ refarm plugin bundle ./plugin.wasm --name my-plugin --output ./dist",
			"  $ REFARM_PACKAGE_MANAGER=npm refarm plugin bundle ./plugin.wasm",
			"",
			"Notes:",
			"  This command runs jco through the detected package manager.",
			"  Refarm maps this to pnpm exec, npm exec --, yarn, or bun x",
			"  based on the project packageManager field or lockfile.",
			"  Override detection with",
			`  REFARM_PACKAGE_MANAGER=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
		].join("\n"),
	)
	.action((input: string, options: { output: string; name?: string }) => {
		const name = options.name ?? basename(input, extname(input));
		console.log(`Bundling plugin ${name} from ${input}...`);
		const command = createPackageBinaryCommand("jco", [
			"transpile",
			input,
			"-o",
			options.output,
			"--name",
			name,
		]);
		try {
			console.log(`  → ${command.display}`);
			execFileSync(command.command, command.args, {
				stdio: "inherit",
			});
			console.log(`  ✓ Plugin bundled to ${options.output}/${name}.js`);
		} catch (e) {
			console.error(`  ✗ Bundle failed: ${e instanceof Error ? e.message : String(e)}`);
			console.error(`    Command: ${command.display}`);
			console.error(
				`    Override package manager with REFARM_PACKAGE_MANAGER=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
			);
			process.exitCode = 1;
		}
	});
