import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

const BUNDLED_PLUGINS = [
	{
		id: "@refarm/pi-agent",
		npmPackage: "@refarm.dev/pi-agent",
		wasmFile: "dist/pi_agent.wasm",
		manifestFile: "dist/plugin.json",
	},
] as const;

const pluginsBaseDir = path.join(os.homedir(), ".refarm", "plugins");

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

interface BundledPlugin {
	readonly id: string;
	readonly npmPackage: string;
	readonly wasmFile: string;
	readonly manifestFile: string;
}

async function installPlugin(
	plugin: BundledPlugin,
	force: boolean,
): Promise<"installed" | "cached" | "failed"> {
	const pkgVersion = readPackageVersion(plugin.npmPackage);
	if (!pkgVersion) {
		console.error(
			`  ✗ ${plugin.id}: cannot resolve package ${plugin.npmPackage}`,
		);
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
		console.error(
			`    Build first: pnpm -C packages/pi-agent run build`,
		);
		return "failed";
	}

	try {
		const wasmBytes = readFileSync(wasmSrc);
		const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
		const integrity = `sha256-${sha256}`;

		const destDir = path.join(pluginsBaseDir, plugin.id);
		await mkdir(destDir, { recursive: true });

		const wasmDest = path.join(destDir, "plugin.wasm");
		copyFileSync(wasmSrc, wasmDest);

		const manifestSrc = path.join(pkgDir, plugin.manifestFile);
		const template = JSON.parse(
			readFileSync(manifestSrc, "utf-8"),
		) as Record<string, unknown>;
		const manifest = { ...template, entry: `file://${wasmDest}`, integrity };
		await writeFile(
			path.join(destDir, "plugin.json"),
			JSON.stringify(manifest, null, 2) + "\n",
			"utf-8",
		);

		const sentinel = sentinelPath(plugin.id);
		await mkdir(path.dirname(sentinel), { recursive: true });
		await writeFile(sentinel, pkgVersion, "utf-8");

		console.log(
			`  ✓ ${plugin.id} v${pkgVersion} installed (${wasmBytes.byteLength} bytes)`,
		);
		return "installed";
	} catch (err) {
		console.error(
			`  ✗ ${plugin.id}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return "failed";
	}
}

export const agentCommand = new Command("agent").description(
	"Manage refarm agent plugins",
);

agentCommand
	.command("install")
	.description("Force-install all bundled agent plugins from npm packages")
	.action(async () => {
		console.log("Installing bundled agent plugins...");
		let failed = 0;
		for (const plugin of BUNDLED_PLUGINS) {
			const status = await installPlugin(plugin, true);
			if (status === "failed") failed++;
		}
		if (failed > 0) process.exit(1);
	});

agentCommand
	.command("update")
	.description("Update bundled agent plugins to the npm package version")
	.action(async () => {
		console.log("Checking bundled agent plugins for updates...");
		let failed = 0;
		for (const plugin of BUNDLED_PLUGINS) {
			const status = await installPlugin(plugin, false);
			if (status === "failed") failed++;
		}
		if (failed > 0) process.exit(1);
	});
