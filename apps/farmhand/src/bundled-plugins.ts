import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export interface BundledEntry {
	id: string;
	package: string;
	wasmFile: string; // relative path within npm package, e.g. "dist/pi_agent.wasm"
	requiredProvides?: string[];
}

export interface BundledResult {
	status: "installed" | "cached" | "failed";
	id: string;
}

export interface BundledSummary {
	installed: number;
	cached: number;
	failed: number;
}

interface LoggerLike {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

function packageDir(packageName: string): string | null {
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
		const pkgJsonPath = require.resolve(`${packageName}/package.json`);
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { version?: string };
		return pkg.version ?? null;
	} catch {
		return null;
	}
}

// Version sentinel: tracks installed version to skip reinstall on every boot
function sentinelPath(pluginsDir: string, pluginId: string): string {
	return path.join(pluginsDir, ".versions", pluginId.replace(/\//g, "_").replace(/@/g, ""));
}

async function readInstalledVersion(pluginsDir: string, pluginId: string): Promise<string | null> {
	try {
		return (await readFile(sentinelPath(pluginsDir, pluginId), "utf-8")).trim();
	} catch {
		return null;
	}
}

async function writeInstalledVersion(pluginsDir: string, pluginId: string, version: string): Promise<void> {
	const p = sentinelPath(pluginsDir, pluginId);
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, version, "utf-8");
}

async function installedBundleIsCurrent(
	pluginsDir: string,
	entry: BundledEntry,
	version: string,
	integrity: string,
): Promise<boolean> {
	const installedVersion = await readInstalledVersion(pluginsDir, entry.id);
	if (installedVersion !== version) return false;

	try {
		const manifestPath = path.join(installDir(pluginsDir, entry.id), "plugin.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
			integrity?: unknown;
			capabilities?: { provides?: unknown };
		};
		if (manifest.integrity !== integrity) return false;
		if (!entry.requiredProvides?.length) return true;
		const provides = Array.isArray(manifest.capabilities?.provides)
			? manifest.capabilities.provides
			: [];
		return entry.requiredProvides.every((capability) => provides.includes(capability));
	} catch {
		return false;
	}
}

// Mirror the convention from scripts/pi-agent-install.mjs:
// - install dir: <pluginsDir>/@refarm/pi-agent/ (scoped like npm)
// - wasm filename: plugin.wasm
// - integrity format: sha256-<hexdigest>
function installDir(pluginsDir: string, pluginId: string): string {
	// pluginId is like "@refarm/pi-agent" — preserve the scoped path
	return path.join(pluginsDir, pluginId);
}

export async function bundleInstallPlugin(
	entry: BundledEntry,
	pluginsDir: string,
	logger: LoggerLike = console,
): Promise<BundledResult> {
	const pkgVersion = readPackageVersion(entry.package);
	if (!pkgVersion) {
		logger.warn(`[farmhand] bundled: ${entry.id}: cannot resolve package ${entry.package}`);
		return { status: "failed", id: entry.id };
	}

	const pkgDir = packageDir(entry.package);
	if (!pkgDir) {
		logger.warn(`[farmhand] bundled: ${entry.id}: cannot locate package directory`);
		return { status: "failed", id: entry.id };
	}

	const wasmSrc = path.join(pkgDir, entry.wasmFile);
	if (!existsSync(wasmSrc)) {
		logger.warn(`[farmhand] bundled: ${entry.id}: WASM not found at ${wasmSrc}`);
		return { status: "failed", id: entry.id };
	}

	try {
		const wasmBytes = readFileSync(wasmSrc);
		const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
		const integrity = `sha256-${sha256}`;

		if (await installedBundleIsCurrent(pluginsDir, entry, pkgVersion, integrity)) {
			logger.info(`[farmhand] bundled: ${entry.id} v${pkgVersion} already installed`);
			return { status: "cached", id: entry.id };
		}

		const destDir = installDir(pluginsDir, entry.id);
		await mkdir(destDir, { recursive: true });

		const wasmDest = path.join(destDir, "plugin.wasm");
		copyFileSync(wasmSrc, wasmDest);

		// Read manifest template from npm package's dist/plugin.json
		const manifestTemplatePath = path.join(pkgDir, "dist/plugin.json");
		const template = JSON.parse(readFileSync(manifestTemplatePath, "utf-8")) as PluginManifest;

		const manifest: PluginManifest = {
			...template,
			entry: `file://${wasmDest}`,
			integrity,
		} as PluginManifest;

		await writeFile(
			path.join(destDir, "plugin.json"),
			JSON.stringify(manifest, null, 2) + "\n",
			"utf-8",
		);

		await writeInstalledVersion(pluginsDir, entry.id, pkgVersion);

		logger.info(`[farmhand] bundled: ${entry.id} v${pkgVersion} installed (${wasmBytes.byteLength} bytes)`);
		return { status: "installed", id: entry.id };
	} catch (err) {
		logger.warn(
			`[farmhand] bundled: ${entry.id}: install failed:`,
			err instanceof Error ? err.message : String(err),
		);
		return { status: "failed", id: entry.id };
	}
}

export async function bundleInstallPlugins(
	entries: BundledEntry[],
	pluginsDir: string,
	logger: LoggerLike = console,
): Promise<BundledSummary> {
	const summary: BundledSummary = { installed: 0, cached: 0, failed: 0 };
	for (const entry of entries) {
		const result = await bundleInstallPlugin(entry, pluginsDir, logger);
		summary[result.status] += 1;
	}
	return summary;
}
