import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { basename, extname } from "node:path";
import path from "node:path";
import { Command } from "commander";
import { createPackageScriptCommand } from "./package-manager.js";
import { readRuntimePluginState } from "./runtime-plugins.js";

// Plugins bundled with the refarm npm package — auto-installed and updated by farmhand on boot.
// To add a new bundled plugin: add an entry here and add it as a dep in farmhand/package.json.
const BUNDLED_PLUGINS = [
	{
		id: "@refarm/pi-agent",
		npmPackage: "@refarm.dev/pi-agent",
		wasmFile: "dist/pi_agent.wasm",
		manifestFile: "dist/plugin.json",
	},
] as const;

type BundledPlugin = (typeof BUNDLED_PLUGINS)[number];

const pluginsBaseDir = path.join(os.homedir(), ".refarm", "plugins");

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
): Promise<"installed" | "cached" | "failed"> {
	const pkgVersion = readPackageVersion(plugin.npmPackage);
	if (!pkgVersion) {
		console.error(`  ✗ ${plugin.id}: package ${plugin.npmPackage} not found in node_modules`);
		return "failed";
	}

	if (!force) {
		const installed = await readInstalledVersion(plugin.id);
		if (installed === pkgVersion) {
			console.log(`  ✓ ${plugin.id} v${pkgVersion} already up-to-date`);
			return "cached";
		}
	}

	const pkgDir = resolvePackageDir(plugin.npmPackage);
	if (!pkgDir) {
		console.error(`  ✗ ${plugin.id}: cannot locate package directory`);
		return "failed";
	}

	const wasmSrc = path.join(pkgDir, plugin.wasmFile);
	if (!existsSync(wasmSrc)) {
		console.error(`  ✗ ${plugin.id}: WASM not found at ${wasmSrc}`);
		console.error(`    Build first: ${localPiAgentBuildCommand()}`);
		return "failed";
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

		console.log(`  ✓ ${plugin.id} v${pkgVersion} installed (${wasmBytes.byteLength} bytes)`);
		return "installed";
	} catch (err) {
		console.error(`  ✗ ${plugin.id}: ${err instanceof Error ? err.message : String(err)}`);
		return "failed";
	}
}

async function listInstalledPlugins(): Promise<void> {
	const results: Array<{ id: string; version: string | null; source: string }> = [];

	for (const plugin of BUNDLED_PLUGINS) {
		const version = await readInstalledVersion(plugin.id);
		results.push({ id: plugin.id, version, source: "bundled" });
	}

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

async function printRuntimePluginStatus(): Promise<void> {
	const state = await readRuntimePluginState();
	if (!state) {
		console.error("Refarm runtime plugin status is unavailable.");
		console.error("Start or restart the runtime with `refarm`, then retry.");
		console.error("Inspect runtime selection with `refarm runtime`.");
		process.exitCode = 1;
		return;
	}

	const known =
		state.known.length > 0 ? state.known : BUNDLED_PLUGINS.map((p) => p.id);
	const idWidth = Math.max(...known.map((id) => id.length), 6);

	console.log(`  ${"PLUGIN".padEnd(idWidth)}  INSTALLED  LOADED  LOCAL`);
	for (const id of known) {
		const installed = state.installed.includes(id) ? "yes" : "no";
		const loaded = state.loaded.includes(id) ? "yes" : "no";
		const local = state.local.includes(id) ? "yes" : "no";
		console.log(
			`  ${id.padEnd(idWidth)}  ${installed.padEnd(9)}  ${loaded.padEnd(6)}  ${local}`,
		);
	}

	if (!state.loaded.includes("@refarm/pi-agent")) {
		console.log("");
		console.log("pi-agent is not loaded.");
		console.log("  Install:  refarm plugin install");
		console.log("  Reload:   /reload @refarm/pi-agent");
		console.log("  Diagnose: refarm doctor");
	}
}

export const pluginCommand = new Command("plugin").description(
	"Manage refarm plugins",
);

pluginCommand
	.command("install")
	.description("Install (or force-reinstall) all bundled plugins from their npm packages")
	.option("-f, --force", "Reinstall even if already up-to-date", false)
	.action(async (options: { force: boolean }) => {
		console.log("Installing bundled plugins...");
		let failed = 0;
		for (const plugin of BUNDLED_PLUGINS) {
			const status = await installPlugin(plugin, options.force);
			if (status === "failed") failed++;
		}
		if (failed > 0) process.exitCode = 1;
	});

pluginCommand
	.command("update")
	.description("Update bundled plugins when a newer npm package version is available")
	.action(async () => {
		console.log("Checking bundled plugins for updates...");
		let failed = 0;
		for (const plugin of BUNDLED_PLUGINS) {
			const status = await installPlugin(plugin, false);
			if (status === "failed") failed++;
		}
		if (failed > 0) process.exitCode = 1;
	});

pluginCommand
	.command("list")
	.description("List installed plugins and their versions")
	.action(listInstalledPlugins);

pluginCommand
	.command("status")
	.description("Show runtime plugin install/load state")
	.action(printRuntimePluginStatus);

pluginCommand
	.command("bundle <input>")
	.description("Transpile a WASM plugin to a JS component using jco transpile")
	.option("-o, --output <dir>", "Output directory", "./dist")
	.option("-n, --name <name>", "Plugin name (defaults to input filename without extension)")
	.action((input: string, options: { output: string; name?: string }) => {
		const name = options.name ?? basename(input, extname(input));
		console.log(`Bundling plugin ${name} from ${input}...`);
		try {
			execFileSync("jco", ["transpile", input, "-o", options.output, "--name", name], {
				stdio: "inherit",
			});
			console.log(`  ✓ Plugin bundled to ${options.output}/${name}.js`);
		} catch (e) {
			console.error(`  ✗ Bundle failed: ${e instanceof Error ? e.message : String(e)}`);
			process.exitCode = 1;
		}
	});
